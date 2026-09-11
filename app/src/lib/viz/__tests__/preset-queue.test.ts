import { expect, test } from "bun:test";
import { PresetQueue } from "../preset-queue";

test("preset loads stay ordered and a compile rejection does not poison the queue", async () => {
  const engine = {};
  const queue = new PresetQueue(() => engine);
  let finish!: () => void;
  const order: string[] = [];
  const first = queue.run(async () => {
    order.push("first");
    await new Promise<void>((r) => {
      finish = r;
    });
  });
  const bad = queue.run(async () => {
    order.push("invalid");
    throw new Error("compile");
  });
  const last = queue.run(async () => {
    order.push("last");
  });
  await Promise.resolve();
  expect(order).toEqual(["first"]);
  finish();
  await first;
  await expect(bad).rejects.toThrow("compile");
  await last;
  expect(order).toEqual(["first", "invalid", "last"]);
});

test("a restart rejects both an in-flight load and old queued work without delaying the new engine", async () => {
  let engine = {};
  const queue = new PresetQueue(() => engine);
  let finish!: () => void,
    staleRan = false,
    currentRan = false;
  const active = queue.run(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  const stale = queue.run(async () => {
    staleRan = true;
  });
  await Promise.resolve();
  engine = {};
  queue.reset();
  await queue.run(async () => {
    currentRan = true;
  });
  expect(currentRan).toBe(true);
  expect(staleRan).toBe(false);
  finish();
  await expect(active).rejects.toThrow("restarted");
  await expect(stale).rejects.toThrow("restarted");
  expect(staleRan).toBe(false);
});
