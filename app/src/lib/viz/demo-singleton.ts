import { AudioEngine } from "./audio-engine";

/**
 * One shared demo engine for the landing page (hero + all gallery thumbs),
 * so 30+ live canvases analyze a single signal instead of 30 AudioContexts.
 *
 * Browsers keep an AudioContext suspended until a user gesture; restarting
 * the demo on the first pointer/key interaction resumes it. Client-only:
 * never call during render.
 */
let shared: AudioEngine | null = null;

export function getDemoEngine(): AudioEngine {
  if (!shared) {
    shared = new AudioEngine();
    shared.startDemo();
    const resume = () => {
      if (shared && shared.source?.kind === "demo") shared.startDemo();
    };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
  }
  return shared;
}
