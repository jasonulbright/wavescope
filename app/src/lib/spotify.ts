import { SpotifySession } from "./spotify-session";

// Access browser globals only on demand; this module also loads during SSR.
let session: SpotifySession | undefined;
function client() {
  return session ??= new SpotifySession({
    storage: localStorage, pending: sessionStorage, fetch: (...args) => fetch(...args),
    lock: async (run) => navigator.locks ? await navigator.locks.request("wavescope-spotify-refresh", run) : await run(),
  });
}

export const redirectUri = () => `${location.origin}/viz`;
export const loadSpotify = () => client().load();
export const disconnectSpotify = () => client().disconnect();
export async function beginSpotifyAuth(clientId: string) {
  location.href = await client().authorize(clientId, redirectUri());
}
export async function completeSpotifyAuth(params: URLSearchParams) {
  await client().complete(params, redirectUri());
}
export function spotifyConnected() {
  const s = loadSpotify();
  return Boolean(s?.refreshToken || (s?.accessToken && (s.expiresAt ?? 0) > Date.now()));
}

async function api(path: string, init?: RequestInit): Promise<{ status: number; json: unknown }> {
  const sessionId = loadSpotify()?.sessionId;
  const token = await client().token();
  if (loadSpotify()?.sessionId !== sessionId) throw new Error("Spotify session changed.");
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init, signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* Empty responses are normal. */ }
  if (loadSpotify()?.sessionId !== sessionId) throw new Error("Spotify session changed.");
  return { status: res.status, json };
}

export interface SpotifyPlayResult { ok: boolean; hint?: string }
export async function spotifyPlay(): Promise<SpotifyPlayResult> {
  const play = await api("/me/player/play", { method: "PUT" });
  if (play.status === 204 || play.status === 200) return { ok: true };
  if (play.status === 404) {
    const devices = await api("/me/player/devices");
    const list = (devices.json as { devices?: Array<{ id: string }> })?.devices;
    const target = Array.isArray(list) ? list.find((d) => typeof d?.id === "string" && d.id) : undefined;
    if (target) {
      const transfer = await api("/me/player", { method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_ids: [target.id], play: true }) });
      if (transfer.status === 204 || transfer.status === 200) return { ok: true };
    }
    return { ok: false, hint: "No Spotify device is available. Open Spotify and press play, then try again." };
  }
  if (play.status === 403) return { ok: false, hint: "Spotify denied playback control. Check Premium and your developer app's allowed users. Audio capture works without connecting." };
  if (play.status === 401) return { ok: false, hint: "Spotify session expired. Disconnect and reconnect." };
  if (play.status === 429) return { ok: false, hint: "Spotify is rate limiting requests. Wait a moment before retrying." };
  return { ok: false, hint: `Spotify did not accept the request (${play.status}).` };
}

export interface NowPlaying { title: string; artist: string }
export async function spotifyNowPlaying(): Promise<NowPlaying | null> {
  try {
    const res = await api("/me/player/currently-playing");
    if (res.status !== 200) return null;
    const item = (res.json as { item?: { name?: string; artists?: Array<{ name: string }> } })?.item;
    if (typeof item?.name !== "string") return null;
    return { title: item.name, artist: Array.isArray(item.artists)
      ? item.artists.filter((a) => typeof a?.name === "string").map((a) => a.name).join(", ") : "" };
  } catch { return null; }
}
