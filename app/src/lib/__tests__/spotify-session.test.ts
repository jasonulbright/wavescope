import { describe, expect, test } from "bun:test";
import { AUTH_KEY, SPOTIFY_KEY, SpotifySession } from "../spotify-session";

const ID = "a".repeat(32);
const URI = "https://example.test/viz";
function storage() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); } };
}
function setup(fetcher: () => Promise<Response> = async () => Response.json({
  access_token: "new-access", refresh_token: "rotated", expires_in: 3600,
})) {
  const saved = storage(), pending = storage();
  let seq = 0;
  const client = new SpotifySession({ storage: saved, pending, fetch: fetcher,
    now: () => 100_000, id: () => String(++seq) });
  const s = client.configure(ID);
  const seed = () => saved.setItem(SPOTIFY_KEY, JSON.stringify({ ...s, refreshToken: "old-refresh", expiresAt: 0 }));
  const auth = (overrides: Record<string, unknown> = {}) => pending.setItem(AUTH_KEY, JSON.stringify({
    ...s, state: "expected", verifier: "verifier", redirectUri: URI, issuedAt: 90_000, ...overrides,
  }));
  return { client, saved, pending, seed, auth };
}

describe("Spotify session boundaries", () => {
  test("failed credential removal still invalidates this tab and a pending refresh", async () => {
    let resolve!: (res: Response) => void;
    const { client, saved, seed } = setup(() => new Promise((r) => { resolve = r; }));
    seed(); const request = client.token();
    saved.removeItem = () => { throw new Error("storage denied"); };
    expect(() => client.disconnect()).toThrow("This tab is disconnected");
    expect(client.load()).toBeNull();
    resolve(Response.json({ access_token: "late", expires_in: 3600 }));
    await expect(request).rejects.toThrow("session changed");
    client.configure(ID); expect(client.load()?.refreshToken).toBeUndefined();
  });
  test("pending-state cleanup failure cannot prevent credential invalidation", () => {
    const { client, pending, seed } = setup(); seed();
    pending.removeItem = () => { throw new Error("session storage denied"); };
    expect(() => client.disconnect()).toThrow("session storage denied");
    expect(client.load()).toBeNull();
  });
  test("configuration validates the ID before changing an existing session", () => {
    const { client, seed } = setup(); seed();
    expect(() => client.configure("bad")).toThrow("Client ID");
    expect(client.load()?.refreshToken).toBe("old-refresh");
  });
  test("simultaneous calls rotate a refresh token only once", async () => {
    let resolve!: (res: Response) => void, calls = 0;
    const { client, seed } = setup(() => { calls++; return new Promise((r) => { resolve = r; }); });
    seed();
    const a = client.token(), b = client.token();
    expect(calls).toBe(1);
    resolve(Response.json({ access_token: "new", refresh_token: "rotated", expires_in: 3600 }));
    expect(await Promise.all([a, b])).toEqual(["new", "new"]);
    expect(client.load()?.refreshToken).toBe("rotated");
  });
  for (const change of ["disconnect", "configure"] as const) {
    test(`late refresh cannot undo ${change}`, async () => {
      let resolve!: (res: Response) => void;
      const { client, seed } = setup(() => new Promise((r) => { resolve = r; }));
      seed(); const request = client.token();
      if (change === "disconnect") client.disconnect(); else client.configure("b".repeat(32));
      resolve(Response.json({ access_token: "late", expires_in: 3600 }));
      await expect(request).rejects.toThrow("session changed");
      expect(client.load()?.accessToken).toBeUndefined();
      expect(client.load()?.clientId).toBe(change === "configure" ? "b".repeat(32) : undefined);
    });
  }
  for (const query of ["code=x", "code=x&state=wrong", "code=x&state=expected&state=expected", "code=x&code=y&state=expected"]) {
    test(`rejects unverified callback: ${query}`, async () => {
      let calls = 0;
      const { client, auth, pending } = setup(async () => { calls++; return new Response(); });
      auth(); await expect(client.complete(new URLSearchParams(query), URI)).rejects.toThrow("verified");
      expect(calls).toBe(0); expect(pending.getItem(AUTH_KEY)).toBeNull();
    });
  }
  test("expired attempts and missing stored state fail closed", async () => {
    const { client, auth } = setup();
    for (const overrides of [{ issuedAt: -600_001 }, { state: "" }]) {
      auth(overrides);
      await expect(client.complete(new URLSearchParams("code=x&state=expected"), URI)).rejects.toThrow("verified");
    }
  });
  test("successful callback is consumed and cannot be replayed", async () => {
    const { client, auth } = setup(); auth();
    const params = new URLSearchParams("code=x&state=expected");
    await client.complete(params, URI);
    expect(client.load()?.accessToken).toBe("new-access");
    await expect(client.complete(params, URI)).rejects.toThrow("verified");
  });
  test("malformed token responses never become stored sessions", async () => {
    const { client, seed } = setup(async () => Response.json({ access_token: 12, expires_in: "forever" }));
    seed(); await expect(client.token()).rejects.toThrow("invalid session");
    expect(client.load()?.accessToken).toBeUndefined();
  });
  test("invalid refresh is cleared, transient failure remains retryable", async () => {
    for (const status of [400, 503]) {
      const { client, seed } = setup(async () => new Response("", { status }));
      seed(); await expect(client.token()).rejects.toThrow();
      expect(client.load()?.refreshToken).toBe(status === 400 ? undefined : "old-refresh");
    }
  });
  test("authorization requires explicit configuration and stores a matched PKCE attempt", async () => {
    const { client, pending } = setup();
    const url = new URL(await client.authorize(ID, URI));
    const attempt = JSON.parse(pending.getItem(AUTH_KEY)!);
    expect(url.searchParams.get("state")).toBe(attempt.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(attempt.verifier.length).toBeGreaterThanOrEqual(43);
    expect(attempt.sessionId).toBe(client.load()?.sessionId);
  });
});
