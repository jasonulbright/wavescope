import { expect, test } from "bun:test";
import { ProjectMEngine, type EmscriptenModule } from "../projectm";

test("projectM forwards explicit cut/morph duration and reports engine rejection", () => {
  const loads: Array<[string, number]> = [];
  const module: EmscriptenModule = {
    cwrap: (name) => {
      if (name === "sv_load_preset_data") return (...args) => {
        loads.push([String(args[0]), Number(args[1])]);
        return args[0] === "invalid" ? 1 : 0;
      };
      if (name === "sv_last_error") return () => "line 2: invalid equation";
      return () => 0;
    },
    _malloc: () => 4, _free: () => {}, HEAPF32: new Float32Array(64),
  };
  const engine = new ProjectMEngine(module);
  engine.loadPresetText("first", 0);
  engine.loadPresetText("next", 5.5);
  expect(() => engine.loadPresetText("invalid", 0)).toThrow("line 2: invalid equation");
  expect(loads).toEqual([["first", 0], ["next", 5.5], ["invalid", 0]]);
  for (const duration of [NaN, Infinity, -1, 11]) {
    expect(() => engine.loadPresetText("next", duration)).toThrow("duration");
  }
  expect(loads).toHaveLength(3);
});
