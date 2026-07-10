/**
 * Spotify integration: start/resume playback on the listener's own Spotify
 * device (desktop app, web player, phone) via the Web API, then WaveScope
 * captures the sound through the system-audio loopback it already has.
 *
 * Why not analyze Spotify's stream directly: Web Playback SDK audio is DRM
 * protected and cannot be tapped by the Web Audio API, and Spotify removed
 * its precomputed audio-analysis endpoints for new apps in late 2024.
 * Loopback capture is the legitimate, working path.
 *
 * Auth is Authorization Code + PKCE, entirely client-side (no secret). A
 * default app client ID ships baked in (public and safe under PKCE); a listener
 * can override it with their own in the Connect panel. Tokens stay in the
 * browser. Playback control requires Spotify Premium (a Spotify rule).
 */

const STORE_KEY = "wavescope-spotify";
const VERIFIER_KEY = "wavescope-spotify-verifier";
const SCOPES = "user-modify-playback-state user-read-playback-state";

/**
 * Baked-in Spotify app client ID. A client ID is public under PKCE (it rides in
 * the browser's authorize URL), so shipping it is safe. Forks can override it by
 * defining VITE_SPOTIFY_CLIENT_ID at build time; a listener can override it per
 * session via the Connect panel's "advanced" field.
 */
const ENV_CLIENT_ID = (
  import.meta.env as unknown as Record<string, string | undefined>
).VITE_SPOTIFY_CLIENT_ID;

export const DEFAULT_SPOTIFY_CLIENT_ID =
  ENV_CLIENT_ID && ENV_CLIENT_ID.length > 0
    ? ENV_CLIENT_ID
    : "89df5ee986864e558952ba356aa968ea";

interface SpotifyStore {
  clientId: string;
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms when accessToken expires. */
  expiresAt?: number;
}

export function redirectUri(): string {
  return `${location.origin}/viz`;
}

export function loadSpotify(): SpotifyStore | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as SpotifyStore) : null;
    return parsed && typeof parsed.clientId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function saveSpotify(s: SpotifyStore | null) {
  try {
    if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // storage blocked: session-only auth
  }
}

export function disconnectSpotify() {
  saveSpotify(null);
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Redirect to Spotify's consent page. Resumes at /viz?code=... */
export async function beginSpotifyAuth(
  clientId: string = DEFAULT_SPOTIFY_CLIENT_ID,
): Promise<void> {
  const raw = new Uint8Array(48);
  crypto.getRandomValues(raw);
  const verifier = base64url(raw.buffer);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  saveSpotify({ clientId });
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("scope", SCOPES);
  location.href = url.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<void> {
  const store = loadSpotify();
  if (!store) throw new Error("not configured");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_id: store.clientId }).toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  saveSpotify({
    ...store,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? store.refreshToken,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  });
}

/** Call on /viz load when ?code= is present. True on success. */
export async function completeSpotifyAuth(code: string): Promise<boolean> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) return false;
  sessionStorage.removeItem(VERIFIER_KEY);
  try {
    await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });
    return true;
  } catch {
    return false;
  }
}

export function spotifyConnected(): boolean {
  const s = loadSpotify();
  return Boolean(s?.refreshToken || (s?.accessToken && (s.expiresAt ?? 0) > Date.now()));
}

async function accessToken(): Promise<string> {
  let store = loadSpotify();
  if (!store) throw new Error("not configured");
  if (!store.accessToken || (store.expiresAt ?? 0) <= Date.now()) {
    if (!store.refreshToken) throw new Error("not authorized");
    await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: store.refreshToken,
    });
    store = loadSpotify()!;
  }
  return store.accessToken!;
}

async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: unknown }> {
  const token = await accessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // 204s and empty bodies are normal
  }
  return { status: res.status, json };
}

export interface SpotifyPlayResult {
  ok: boolean;
  /** Human-readable next step when playback could not start. */
  hint?: string;
}

/**
 * Start or resume playback on the user's Spotify. If nothing is active,
 * transfer playback to the first available device.
 */
export async function spotifyPlay(): Promise<SpotifyPlayResult> {
  const play = await api("/me/player/play", { method: "PUT" });
  if (play.status === 204 || play.status === 200) return { ok: true };

  if (play.status === 404) {
    // No active device: look for one and transfer playback to it.
    const devices = await api("/me/player/devices");
    const list =
      (devices.json as { devices?: Array<{ id: string; name: string }> })
        ?.devices ?? [];
    if (list.length) {
      const target = list[0];
      const transfer = await api("/me/player", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_ids: [target.id], play: true }),
      });
      if (transfer.status === 204 || transfer.status === 200) return { ok: true };
    }
    return {
      ok: false,
      hint: "No Spotify device is running. Open Spotify (app or web player), then try again.",
    };
  }
  if (play.status === 403) {
    return {
      ok: false,
      hint: "Spotify only allows remote playback control on Premium accounts.",
    };
  }
  if (play.status === 401) {
    return { ok: false, hint: "Spotify session expired. Reconnect and try again." };
  }
  return { ok: false, hint: `Spotify did not accept the request (${play.status}).` };
}

export interface NowPlaying {
  title: string;
  artist: string;
}

export async function spotifyNowPlaying(): Promise<NowPlaying | null> {
  try {
    const res = await api("/me/player/currently-playing");
    if (res.status !== 200) return null;
    const item = (res.json as { item?: { name?: string; artists?: Array<{ name: string }> } })
      ?.item;
    if (!item?.name) return null;
    return {
      title: item.name,
      artist: (item.artists ?? []).map((a) => a.name).join(", "),
    };
  } catch {
    return null;
  }
}
