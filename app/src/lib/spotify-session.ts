/** Browser-independent session lifecycle, with injected storage and transport. */
export interface SpotifyStore {
  clientId: string;
  sessionId: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export const SPOTIFY_KEY = "wavescope-spotify";
export const AUTH_KEY = "wavescope-spotify-auth";
export const validClientId = (id: string) => /^[a-f\d]{32}$/i.test(id);

interface SessionOptions {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  pending: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  id?: () => string;
  lock?: (run: () => Promise<string>) => Promise<string>;
}

interface PendingAuth {
  clientId: string;
  sessionId: string;
  state: string;
  verifier: string;
  redirectUri: string;
  issuedAt: number;
}

export class SpotifySession {
  private fallback: SpotifyStore | null = null;
  private refresh: { key: string; promise: Promise<string> } | null = null;
  private now: () => number;
  private id: () => string;

  constructor(private options: SessionOptions) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? (() => crypto.randomUUID());
  }

  load(): SpotifyStore | null {
    try {
      const value: unknown = JSON.parse(this.options.storage.getItem(SPOTIFY_KEY) ?? "null");
      if (!value || typeof value !== "object") return null;
      const s = value as SpotifyStore;
      if (!validClientId(s.clientId ?? "")) return null;
      // Existing configured accounts migrate once; no shared default is supplied.
      if (!s.sessionId) {
        s.sessionId = this.id();
        this.save(s);
      }
      return {
        clientId: s.clientId, sessionId: s.sessionId,
        accessToken: typeof s.accessToken === "string" ? s.accessToken : undefined,
        refreshToken: typeof s.refreshToken === "string" ? s.refreshToken : undefined,
        expiresAt: typeof s.expiresAt === "number" ? s.expiresAt : undefined,
      };
    } catch { return this.fallback; }
  }

  private save(s: SpotifyStore | null) {
    this.fallback = s;
    if (s) this.options.storage.setItem(SPOTIFY_KEY, JSON.stringify(s));
    else this.options.storage.removeItem(SPOTIFY_KEY);
  }

  configure(clientId: string) {
    const id = clientId.trim();
    if (!validClientId(id)) throw new Error("Enter the 32-character Client ID from your Spotify developer app.");
    const s = { clientId: id, sessionId: this.id() };
    this.options.pending.removeItem(AUTH_KEY);
    this.save(s);
    return s;
  }

  disconnect() {
    this.options.pending.removeItem(AUTH_KEY);
    this.save(null);
  }

  private current(s: SpotifyStore) {
    const latest = this.load();
    return latest?.clientId === s.clientId && latest.sessionId === s.sessionId &&
      latest.refreshToken === s.refreshToken;
  }

  async authorize(clientId: string, redirectUri: string) {
    const s = this.configure(clientId);
    const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const verifier = encode(crypto.getRandomValues(new Uint8Array(48)));
    const state = encode(crypto.getRandomValues(new Uint8Array(24)));
    const challenge = encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    if (!this.current(s)) throw new Error("Spotify configuration changed. Connect again.");
    const pending: PendingAuth = { ...s, verifier, state, redirectUri, issuedAt: this.now() };
    this.options.pending.setItem(AUTH_KEY, JSON.stringify(pending));
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({ client_id: s.clientId, response_type: "code",
      redirect_uri: redirectUri, code_challenge_method: "S256", code_challenge: challenge,
      scope: "user-modify-playback-state user-read-playback-state user-read-currently-playing", state }).toString();
    return url.toString();
  }

  async complete(params: URLSearchParams, redirectUri: string) {
    const raw = this.options.pending.getItem(AUTH_KEY);
    this.options.pending.removeItem(AUTH_KEY); // one use, including rejected callbacks
    const p = raw ? JSON.parse(raw) as PendingAuth : null;
    const s = this.load();
    const age = p ? this.now() - p.issuedAt : Infinity;
    if (!p || !s || !p.state || !p.verifier || !Number.isFinite(age) || age < 0 || age > 600_000 ||
        p.redirectUri !== redirectUri || p.clientId !== s.clientId || p.sessionId !== s.sessionId ||
        params.getAll("state").length !== 1 || params.get("state") !== p.state ||
        params.getAll("code").length > 1 || params.getAll("error").length > 1) {
      throw new Error("Spotify sign-in could not be verified. Connect again from this tab.");
    }
    if (params.has("error")) throw new Error("Spotify sign-in was cancelled or declined. You can still capture Spotify audio.");
    const code = params.get("code");
    if (!code) throw new Error("Spotify returned no authorization code. Connect again.");
    await this.exchange(s, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: p.verifier });
  }

  private async exchange(s: SpotifyStore, body: Record<string, string>): Promise<string> {
    const res = await this.options.fetch("https://accounts.spotify.com/api/token", {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...body, client_id: s.clientId }).toString(),
    });
    if (!this.current(s)) throw new Error("Spotify session changed. Connect again if needed.");
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) this.save({ clientId: s.clientId, sessionId: s.sessionId });
      throw new Error(`Spotify sign-in expired or could not refresh (${res.status}). Connect again.`);
    }
    const data = await res.json() as Record<string, unknown>;
    if (!this.current(s)) throw new Error("Spotify session changed. Connect again if needed.");
    if (typeof data.access_token !== "string" || !data.access_token ||
        typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
        (data.refresh_token !== undefined && (typeof data.refresh_token !== "string" || !data.refresh_token))) {
      throw new Error("Spotify returned an invalid session. Connect again.");
    }
    this.save({ ...s, accessToken: data.access_token,
      refreshToken: data.refresh_token as string | undefined ?? s.refreshToken,
      expiresAt: this.now() + Math.max(1, data.expires_in - Math.min(60, data.expires_in / 10)) * 1000 });
    return data.access_token;
  }

  async token(): Promise<string> {
    const s = this.load();
    if (!s) throw new Error("Configure and connect Spotify first.");
    if (s.accessToken && (s.expiresAt ?? 0) > this.now()) return s.accessToken;
    if (!s.refreshToken) throw new Error("Connect Spotify again to renew your session.");
    const key = `${s.sessionId}:${s.refreshToken}`;
    if (this.refresh?.key === key) return this.refresh.promise;
    const run = async () => {
      const latest = this.load();
      if (latest?.sessionId !== s.sessionId) throw new Error("Spotify session changed.");
      if (latest.accessToken && (latest.expiresAt ?? 0) > this.now()) return latest.accessToken;
      if (!latest.refreshToken) throw new Error("Connect Spotify again.");
      return this.exchange(latest, { grant_type: "refresh_token", refresh_token: latest.refreshToken });
    };
    const promise = this.options.lock ? this.options.lock(run) : run();
    const entry = { key, promise };
    this.refresh = entry;
    try { return await promise; }
    finally { if (this.refresh === entry) this.refresh = null; }
  }
}
