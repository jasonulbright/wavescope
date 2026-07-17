import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GPU_MODES, PRELUDE, gpuModeById } from "../webgpu";
import { BUNDLED_MILK } from "../projectm";
import { MODES, DEFAULT_MODE, modeById } from "../modes";

/* Registry integrity: every id/name unique, every lookup total (never
 * undefined), every bundled asset actually shipped. These are the invariants
 * the console UI leans on without checking. */

describe("GPU_MODES", () => {
  test("ids are unique", () => {
    const ids = GPU_MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every fragment defines fs() and none redefines the prelude", () => {
    for (const m of GPU_MODES) {
      expect(m.fragment).toContain("fn fs(");
      expect(m.fragment).not.toContain("fn vs(");
      expect(m.fragment).not.toContain("struct U");
    }
  });

  test("prelude exposes the audio-texture helpers modes rely on", () => {
    for (const helper of ["fn spec(", "fn specLog(", "fn wav("]) {
      expect(PRELUDE).toContain(helper);
    }
  });

  test("gpuModeById is total (falls back to the first mode)", () => {
    expect(gpuModeById(undefined).id).toBe(GPU_MODES[0].id);
    expect(gpuModeById("no-such-mode").id).toBe(GPU_MODES[0].id);
    expect(gpuModeById("gpu-spectrum").id).toBe("gpu-spectrum");
  });
});

describe("BUNDLED_MILK", () => {
  test("names and urls are unique", () => {
    expect(new Set(BUNDLED_MILK.map((b) => b.name)).size).toBe(BUNDLED_MILK.length);
    expect(new Set(BUNDLED_MILK.map((b) => b.url)).size).toBe(BUNDLED_MILK.length);
  });

  test("every bundled preset file exists in public/", () => {
    const publicDir = join(import.meta.dir, "../../../../public");
    for (const b of BUNDLED_MILK) {
      expect(existsSync(join(publicDir, b.url))).toBe(true);
    }
  });
});

describe("MODES (built-in engine)", () => {
  test("ids are unique and the default resolves", () => {
    const ids = MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MODES).toContain(DEFAULT_MODE);
  });

  test("modeById is total", () => {
    expect(modeById(undefined).id).toBe(DEFAULT_MODE.id);
    expect(modeById("definitely-not-a-mode").id).toBe(DEFAULT_MODE.id);
  });
});
