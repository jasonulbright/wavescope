import { describe, expect, test } from "bun:test";
import {
  PALETTES,
  DEFAULT_PALETTE,
  paletteById,
  customToPalette,
  type CustomPaletteDef,
} from "../palettes";

describe("palettes", () => {
  test("ids are unique", () => {
    const ids = PALETTES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("paletteById is total (unknown ids fall back to the default)", () => {
    expect(paletteById("nope")).toBe(DEFAULT_PALETTE);
    expect(paletteById("magma").id).toBe("magma");
  });

  test("every palette emits a css color across the whole axis", () => {
    for (const p of PALETTES) {
      for (const pos of [0, 0.25, 0.5, 0.75, 1]) {
        const c = p.color(pos, 0.8);
        expect(c).toMatch(/^(hsla?|rgba?)\(/);
        expect(c).toContain("0.8");
      }
      expect(p.bg).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test("alpha defaults to fully opaque", () => {
    expect(DEFAULT_PALETTE.color(0.5)).toContain("1)");
  });

  test("customToPalette produces a working palette", () => {
    const def: CustomPaletteDef = {
      id: "custom-test",
      name: "Test",
      stops: ["#ff0000", "#00ff00", "#0000ff"],
    };
    const p = customToPalette(def);
    expect(p.id).toBe("custom-test");
    for (const pos of [0, 0.5, 1]) {
      expect(p.color(pos, 1)).toMatch(/^(hsla?|rgba?)\(/);
    }
  });
});
