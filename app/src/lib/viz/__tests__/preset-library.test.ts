import { expect, test } from "bun:test";
import { saveNewPreset } from "../preset-library";

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
