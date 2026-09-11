import { expect, test } from "bun:test";
import { saveNewPreset, favoriteKey, favoritePool } from "../preset-library";

test("Save As preserves existing and bundled presets, including case variants", () => {
  const original = { saved: { source: "original" } };
  for (const name of ["saved", " SAVED ", "Bundled"]) {
    expect(() => saveNewPreset(name, { source: "edit" }, original, ["Bundled"], () => true)).toThrow("already exists");
  }
  expect(original.saved.source).toBe("original");
});
test("failed persistence never publishes a saved preset", () => {
  const original = { saved: "original" };
  expect(() => saveNewPreset("new", "edit", original, [], () => false)).toThrow("could not be saved");
  expect(Object.keys(original)).toEqual(["saved"]);
});
test("successful Save As returns a new library without changing the original", () => {
  const original = { saved: "original" };
  const next = saveNewPreset(" new ", "edit", original, [], () => true);
  expect(next).toEqual({ saved: "original", new: "edit" });
  expect(Object.keys(original)).toEqual(["saved"]);
});
test("favorites are scoped by engine and empty filtered pools remain empty", () => {
  const favorites = [favoriteKey("milk", "same name")];
  expect(favoritePool(["same name", "other"], "milk", favorites, true, (v) => v)).toEqual(["same name"]);
  expect(favoritePool(["same name"], "pm", favorites, true, (v) => v)).toEqual([]);
  expect(favoritePool(["one", "two"], "pm", [], false, (v) => v)).toEqual(["one", "two"]);
});
