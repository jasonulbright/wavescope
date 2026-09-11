export const ENGINE_RESTARTED = "The engine restarted before this preset applied; try again.";

/** Preserve submission order, but never report a load on a retired engine. */
export class PresetQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  constructor(private current: () => T | null) {}
  reset() {
    this.tail = Promise.resolve();
  }
  run(load: (engine: T) => Promise<void>): Promise<void> {
    const engine = this.current();
    const run = this.tail.then(async () => {
      if (!engine || this.current() !== engine) throw new Error(ENGINE_RESTARTED);
      await load(engine);
      if (this.current() !== engine) throw new Error(ENGINE_RESTARTED);
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
