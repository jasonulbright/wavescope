import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Boots the real public/sw.js with faked service-worker globals and drives
 * its fetch handler directly. Exists because of a real incident: during a
 * deploy race the host's SPA rewrite answers 200 text/html for ANY path, and
 * an early version of the worker cached that HTML under engine asset URLs
 * (/vendor/*.js, /projectm/*.js), breaking the milkdrop and projectM engines
 * until the cache revalidated.
 */

const ORIGIN = "https://wavescope.test";

interface FakeEvent {
  request: { method: string; url: string; mode: string };
  response?: Promise<Response>;
  respondWith(p: Promise<Response> | Response): void;
  waitUntil(p: Promise<unknown>): void;
}

function bootSw() {
  const stores = new Map<string, Map<string, Response>>();
  const deleted: string[] = [];
  let existingKeys = ["ws-v1"];

  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    const keyOf = (req: unknown) =>
      typeof req === "string" ? new URL(req, ORIGIN).href : (req as { url: string }).url;
    return {
      add: async (url: string) => {
        store.set(
          keyOf(url),
          new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
        );
      },
      put: async (req: unknown, res: Response) => {
        store.set(keyOf(req), res);
      },
      match: async (req: unknown) => store.get(keyOf(req)),
    };
  };

  const handlers = new Map<string, (e: FakeEvent) => void>();
  const self = {
    addEventListener: (name: string, fn: (e: FakeEvent) => void) => {
      handlers.set(name, fn);
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const caches = {
    open: async (name: string) => cacheFor(name),
    keys: async () => existingKeys,
    delete: async (name: string) => {
      deleted.push(name);
      stores.delete(name);
      return true;
    },
    match: async (req: unknown) => {
      for (const name of stores.keys()) {
        const hit = await cacheFor(name).match(req);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  let nextFetch: () => Promise<Response> = async () => Response.error();
  const fetch = () => nextFetch();

  const code = readFileSync(join(import.meta.dir, "../../../public/sw.js"), "utf8");
  new Function("self", "caches", "location", "fetch", code)(
    self,
    caches,
    { origin: ORIGIN },
    fetch,
  );

  const dispatchFetch = (url: string, mode = "no-cors"): Promise<Response> => {
    let out: Promise<Response> | Response | undefined;
    const event: FakeEvent = {
      request: { method: "GET", url: new URL(url, ORIGIN).href, mode },
      respondWith: (p) => {
        out = p;
      },
      waitUntil: () => {},
    };
    handlers.get("fetch")!(event);
    if (out === undefined) throw new Error("handler did not respond");
    return Promise.resolve(out);
  };

  return {
    handlers,
    dispatchFetch,
    setFetch: (fn: () => Promise<Response>) => {
      nextFetch = fn;
    },
    cached: (name: string, url: string) => stores.get(name)?.get(new URL(url, ORIGIN).href),
    setExistingKeys: (k: string[]) => {
      existingKeys = k;
    },
    deleted,
  };
}

const html = () =>
  new Response("<!doctype html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const js = () =>
  new Response("!function(){}", {
    status: 200,
    headers: { "content-type": "application/javascript" },
  });

let sw: ReturnType<typeof bootSw>;
beforeEach(() => {
  sw = bootSw();
});

describe("sw.js rewrite-poisoning guard", () => {
  test("a 200 HTML answer for a vendor .js is served but NEVER cached", async () => {
    sw.setFetch(async () => html());
    const res = await sw.dispatchFetch("/vendor/butterchurn.min.js");
    expect(res.status).toBe(200); // pass-through is fine…
    await new Promise((r) => setTimeout(r, 5));
    expect(sw.cached("ws-v2", "/vendor/butterchurn.min.js")).toBeUndefined(); // …caching is not
  });

  test("a 200 HTML answer for a hashed asset is never cached either", async () => {
    sw.setFetch(async () => html());
    await sw.dispatchFetch("/assets/viz-abc123.js");
    await new Promise((r) => setTimeout(r, 5));
    expect(sw.cached("ws-v2", "/assets/viz-abc123.js")).toBeUndefined();
  });

  test("real javascript responses ARE cached (SWR path)", async () => {
    sw.setFetch(async () => js());
    await sw.dispatchFetch("/vendor/butterchurn.min.js");
    await new Promise((r) => setTimeout(r, 5));
    expect(sw.cached("ws-v2", "/vendor/butterchurn.min.js")).toBeDefined();
  });

  test("real javascript responses ARE cached (cache-first assets path)", async () => {
    sw.setFetch(async () => js());
    await sw.dispatchFetch("/assets/viz-abc123.js");
    await new Promise((r) => setTimeout(r, 5));
    expect(sw.cached("ws-v2", "/assets/viz-abc123.js")).toBeDefined();
  });

  test("navigations still cache the HTML shell", async () => {
    sw.setFetch(async () => html());
    await sw.dispatchFetch("/viz", "navigate");
    await new Promise((r) => setTimeout(r, 5));
    expect(sw.cached("ws-v2", "/index.html")).toBeDefined();
  });

  test("activate purges old cache versions (heals poisoned ws-v1)", async () => {
    sw.setExistingKeys(["ws-v1", "ws-v2"]);
    let done: Promise<unknown> = Promise.resolve();
    sw.handlers.get("activate")!({
      request: { method: "GET", url: ORIGIN, mode: "" },
      respondWith: () => {},
      waitUntil: (p) => {
        done = p;
      },
    });
    await done;
    expect(sw.deleted).toContain("ws-v1");
    expect(sw.deleted).not.toContain("ws-v2");
  });
});
