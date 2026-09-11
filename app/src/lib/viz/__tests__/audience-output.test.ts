import { expect, test } from "bun:test";
import { AudienceOutput, EMPTY_OUTPUT, type OutputState } from "../audience-output";

function setup() {
  let state: OutputState = { ...EMPTY_OUTPUT };
  let tick = () => {};
  let message = (_event: unknown) => {};
  let blocked = false;
  const streams: { active: boolean; stopped: boolean; getTracks: () => { stop: () => void }[] }[] = [];
  function makeCanvas() {
    return { captureStream() {
      const stream = { active: true, stopped: false, getTracks: () => [{
        stop() { stream.active = false; stream.stopped = true; },
      }] };
      streams.push(stream);
      return stream;
    } } as unknown as HTMLCanvasElement;
  }
  let canvas: HTMLCanvasElement | null = makeCanvas();
  const video = {
    srcObject: null as unknown, style: { visibility: "" },
    readyState: 0, videoWidth: 0, videoHeight: 0, paused: true,
    ownerDocument: {} as unknown,
    play: () => Promise.resolve(),
  };
  const popup = {
    closed: false, document: { querySelector: () => video }, focus() {},
    close() { this.closed = true; },
  };
  video.ownerDocument = popup.document;
  const host = {
    crypto: { randomUUID: () => "session-token" },
    location: { origin: "https://wavescope.example" },
    open: () => blocked ? null : popup,
    setInterval(fn: () => void) { tick = fn; return 1; }, clearInterval() { tick = () => {}; },
    addEventListener(_type: string, fn: typeof message) { message = fn; },
    removeEventListener() { message = () => {}; },
  };
  const output = new AudienceOutput(() => canvas, (s) => { state = s; }, host as unknown as Window);
  const ready = (overrides = {}) => message({
    origin: host.location.origin, source: popup,
    data: { type: "wavescope-output-ready", token: "session-token" }, ...overrides,
  });
  const decoded = () => {
    video.readyState = 2; video.videoWidth = 1920; video.videoHeight = 1080; video.paused = false; tick();
  };
  return {
    output, ready, decoded, video, popup, streams, makeCanvas,
    tick: () => tick(), state: () => state,
    setCanvas: (value: HTMLCanvasElement | null) => { canvas = value; },
    block: () => { blocked = true; },
  };
}

test("audience requires the expected origin, window, and one-session handshake", () => {
  const s = setup(); s.output.open();
  s.ready({ origin: "https://other.example" });
  s.ready({ source: {} });
  s.ready({ data: { type: "wavescope-output-ready", token: "old-session" } });
  expect(s.streams).toHaveLength(0);
  s.ready(); expect(s.streams).toHaveLength(1);
  expect(s.state().linked).toBe(false);
  s.decoded(); expect(s.state().linked).toBe(true); expect(s.state().size).toBe("1920×1080");
  s.output.dispose();
});

test("renderer replacement releases the old stream and ignores its late play rejection", async () => {
  const s = setup(); let reject!: (error: Error) => void;
  s.video.play = () => new Promise((_, r) => { reject = r; });
  s.output.open(); s.ready();
  s.video.play = () => Promise.resolve();
  s.setCanvas(s.makeCanvas()); s.tick(); s.decoded();
  expect(s.streams).toHaveLength(2); expect(s.streams[0].stopped).toBe(true);
  reject(new Error("old renderer")); await Promise.resolve(); await Promise.resolve();
  expect(s.state().linked).toBe(true); expect(s.state().error).toBeNull();
  s.output.dispose(); expect(s.streams[1].stopped).toBe(true);
});

test("blackout survives renderer changes without stopping the operator canvas", () => {
  const s = setup(); s.output.open(); s.ready(); s.decoded();
  s.output.blackout(true); expect(s.video.style.visibility).toBe("hidden");
  expect(s.streams[0].active).toBe(true);
  s.setCanvas(s.makeCanvas()); s.tick(); expect(s.video.style.visibility).toBe("hidden");
  s.output.blackout(false); expect(s.video.style.visibility).toBe("visible");
  s.output.dispose();
});

test("closed windows and missing canvases release tracks and clear status", () => {
  const s = setup(); s.output.open(); s.ready(); s.decoded();
  s.setCanvas(null); s.tick(); expect(s.video.srcObject).toBeNull();
  expect(s.streams[0].stopped).toBe(true); expect(s.state().linked).toBe(false);
  s.popup.closed = true; s.tick(); expect(s.state()).toEqual(EMPTY_OUTPUT);
  s.output.dispose();
});

test("playback denial is actionable and a later audience gesture recovers status", async () => {
  const s = setup(); s.video.play = () => Promise.reject(new Error("autoplay"));
  s.output.open(); s.ready(); await Promise.resolve();
  expect(s.state().error).toContain("Double-click");
  s.decoded(); expect(s.state().linked).toBe(true); expect(s.state().error).toBeNull();
  s.output.dispose();
});

test("navigation disconnects the old document until another valid handshake", () => {
  const s = setup(); s.output.open(); s.ready(); s.decoded();
  s.popup.document = { querySelector: () => s.video };
  s.tick(); expect(s.state().linked).toBe(false); expect(s.streams[0].stopped).toBe(true);
  expect(s.video.srcObject).toBeNull();
  s.video.ownerDocument = s.popup.document;
  s.ready(); expect(s.streams).toHaveLength(2);
  s.output.dispose();
});

test("blocked popups and canvas capture failures remain on the console", () => {
  const blocked = setup(); blocked.block(); blocked.output.open();
  expect(blocked.state().open).toBe(false); expect(blocked.state().error).toContain("Allow popups");
  blocked.output.dispose();
  const s = setup();
  s.setCanvas({ captureStream() { throw new Error("capture"); } } as unknown as HTMLCanvasElement);
  s.output.open(); s.ready(); expect(s.state().linked).toBe(false);
  expect(s.state().error).toContain("could not capture"); expect(s.video.srcObject).toBeNull();
  s.output.dispose();
});
