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

export const favoriteKey = (engine: string, id: string) => JSON.stringify([engine, id]);
export function favoritePool<T>(items: readonly T[], engine: string, favorites: readonly string[],
  onlyFavorites: boolean, id: (item: T) => string): T[] {
  return items.filter((item) => !onlyFavorites || favorites.includes(favoriteKey(engine, id(item))));
}
export function loadPresetPreferences() {
  try {
    const p = JSON.parse(localStorage.getItem("wavescope-library") ?? "{}");
    return { favorites: Array.isArray(p.favorites) ? p.favorites.filter((f: unknown): f is string => typeof f === "string") : [],
      shuffleFavorites: p.shuffleFavorites === true };
  } catch { return { favorites: [] as string[], shuffleFavorites: false }; }
}
