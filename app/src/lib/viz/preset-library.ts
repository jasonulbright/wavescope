/** Save As never replaces a bundled or user preset, and publishes only after storage succeeds. */
export function saveNewPreset<T>(
  name: string, preset: T, current: Record<string, T>, reserved: readonly string[],
  persist: (next: Record<string, T>) => boolean,
): Record<string, T> {
  const clean = name.trim();
  if (!clean || clean.length > 160) throw new Error("Use a preset name between 1 and 160 characters.");
  const names = [...Object.keys(current), ...reserved];
  if (names.some((n) => n.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
    throw new Error("That preset name already exists. Choose a new name.");
  }
  const next = { ...current, [clean]: preset };
  if (!persist(next)) throw new Error("The preset could not be saved. Browser storage may be full or blocked. Export a copy or free space and retry.");
  return next;
}
