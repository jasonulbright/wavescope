import { useState } from "react";
import {
  beginSpotifyAuth,
  disconnectSpotify,
  loadSpotify,
  redirectUri,
  spotifyConnected,
  spotifyPlay,
} from "../../lib/spotify";

interface SpotifyPanelProps {
  /** Arms the system-audio capture (must be called from this click). */
  onCapture: () => void;
  onClose: () => void;
}

/**
 * The Spotify flow. Two tiers:
 *  - Quick: open Spotify, press play there, capture the tab/system audio.
 *  - Connected: with the user's own (free) Spotify app client ID, the play
 *    button starts playback on their device remotely, then capture.
 */
export function SpotifyPanel({ onCapture, onClose }: SpotifyPanelProps) {
  const [connected, setConnected] = useState(() => spotifyConnected());
  const [clientId, setClientId] = useState(() => loadSpotify()?.clientId ?? "");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const play = async () => {
    setBusy(true);
    setHint(null);
    try {
      const res = await spotifyPlay();
      if (res.ok) {
        setPlaying(true);
        setHint("Spotify is playing. Now capture the sound: pick the screen or the Spotify tab and tick Share audio.");
      } else {
        setHint(res.hint ?? "Playback did not start.");
      }
    } catch {
      setHint("Spotify session expired. Reconnect below.");
      setConnected(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-scope/80 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto border border-white/15 bg-scope p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <p className="readout text-ultra-soft">SPOTIFY</p>
          <button
            onClick={onClose}
            className="font-meter text-xs text-white/50 hover:text-white"
          >
            close
          </button>
        </div>

        {connected ? (
          <div className="mt-6">
            <button
              onClick={() => void play()}
              disabled={busy}
              className="w-full border border-ultra bg-ultra/20 px-5 py-3.5 font-meter text-sm font-bold text-ultra-soft hover:bg-ultra/35 active:scale-[0.99] disabled:opacity-50"
            >
              {busy ? "starting playback" : "Play on Spotify"}
            </button>
            {playing ? (
              <button
                onClick={() => {
                  onCapture();
                  onClose();
                }}
                className="mt-3 w-full border border-white/20 px-5 py-3.5 font-meter text-sm text-white/85 hover:border-white/50 active:scale-[0.99]"
              >
                Capture the sound
              </button>
            ) : null}
            {hint ? (
              <p className="mt-4 border border-white/15 px-3 py-2.5 font-meter text-xs leading-relaxed text-white/60">
                {hint}
              </p>
            ) : null}
            <button
              onClick={() => {
                disconnectSpotify();
                setConnected(false);
                setPlaying(false);
                setHint(null);
              }}
              className="mt-5 font-meter text-xs text-white/40 hover:text-white/70"
            >
              disconnect spotify
            </button>
          </div>
        ) : (
          <div className="mt-6">
            <p className="font-meter text-sm font-bold text-white/85">Quick start</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 font-meter text-xs leading-relaxed text-white/60">
              <li>Open Spotify and press play there.</li>
              <li>Come back and hit capture: pick the Spotify tab or the whole screen, and tick Share audio.</li>
            </ol>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => window.open("https://open.spotify.com", "_blank")}
                className="flex-1 border border-white/20 px-4 py-2.5 font-meter text-xs text-white/85 hover:border-white/50 active:scale-[0.99]"
              >
                open Spotify
              </button>
              <button
                onClick={() => {
                  onCapture();
                  onClose();
                }}
                className="flex-1 border border-ultra bg-ultra/20 px-4 py-2.5 font-meter text-xs text-ultra-soft hover:bg-ultra/35 active:scale-[0.99]"
              >
                capture the sound
              </button>
            </div>

            <div className="mt-7 border-t border-white/10 pt-5">
              <p className="font-meter text-sm font-bold text-white/85">
                One-button mode (optional)
              </p>
              <p className="mt-1.5 font-meter text-xs leading-relaxed text-white/50">
                Connect your Spotify account and the play button here starts
                playback on your device remotely, then captures it. Needs
                Spotify Premium.
              </p>
              <button
                onClick={() => void beginSpotifyAuth(clientId.trim() || undefined)}
                className="mt-3 w-full border border-ultra bg-ultra/20 px-5 py-3 font-meter text-sm font-bold text-ultra-soft hover:bg-ultra/35 active:scale-[0.99]"
              >
                Connect Spotify
              </button>
              <button
                onClick={() => setSetupOpen((v) => !v)}
                className="mt-3 font-meter text-xs text-white/40 hover:text-white/80"
              >
                {setupOpen ? "hide" : "use your own Spotify app (advanced)"}
              </button>
              {setupOpen ? (
                <div className="mt-2">
                  <p className="font-meter text-xs leading-relaxed text-white/50">
                    Optional: use your own Spotify developer app instead of the
                    built-in one (e.g. to avoid the shared app's user limit).
                  </p>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-5 font-meter text-xs leading-relaxed text-white/60">
                    <li>Go to developer.spotify.com/dashboard and create an app (any name).</li>
                    <li>
                      Add this exact redirect URI:{" "}
                      <span className="break-all text-ultra-soft">{redirectUri()}</span>
                    </li>
                    <li>Paste the app's Client ID below, then Connect Spotify.</li>
                  </ol>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="Your Spotify client ID"
                    className="mt-3 w-full min-w-0 border border-white/15 bg-scope px-3 py-2 font-meter text-xs text-white/85 placeholder:text-white/30"
                  />
                </div>
              ) : null}
            </div>
          </div>
        )}

        <p className="mt-6 border-t border-white/10 pt-4 font-meter text-xs leading-relaxed text-white/40">
          Spotify's stream itself is DRM protected, so WaveScope listens
          through the system-audio capture. Your Spotify credentials and
          tokens stay in this browser.
        </p>
      </div>
    </div>
  );
}
