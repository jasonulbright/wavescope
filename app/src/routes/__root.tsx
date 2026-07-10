import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
// Page metadata (browser <title>/favicon + social og: tags), committed in the
// repo and read at BUILD time — no runtime fetch.
import appMetaJson from "../app-meta.json";

const DEFAULT_TITLE = "WaveScope";
const DEFAULT_DESCRIPTION =
  "A music visualizer built like an instrument: 34 built-in modes plus real MilkDrop and WebGPU shader engines, any audio source, up to 8K, on every display you own.";

type AppMeta = {
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
  favicon_url?: string | null;
  og_video_url?: string | null;
};

const appMeta = appMetaJson as AppMeta;

// favicon/og images are self-hosted in this app's own /assets; app-meta.json
// carries root-relative paths, so pass the value through (null-normalized).
function toOwnAssetUrl(value: string | null | undefined): string | null {
  return value ?? null;
}

function buildHead(meta: AppMeta) {
  const title = meta.og_title ?? DEFAULT_TITLE;
  const description = meta.og_description ?? DEFAULT_DESCRIPTION;
  const ogImage = toOwnAssetUrl(meta.og_image_url);
  const favicon = toOwnAssetUrl(meta.favicon_url);
  const ogVideo = toOwnAssetUrl(meta.og_video_url);

  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title },
      { name: "description", content: description },
      { name: "theme-color", content: "#f2f4f1" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: ogImage ? "summary_large_image" : "summary" },
      ...(ogImage
        ? [
            { property: "og:image", content: ogImage },
            { name: "twitter:image", content: ogImage },
          ]
        : []),
      ...(ogVideo ? [{ property: "og:video", content: ogVideo }] : []),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://api.fontshare.com" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous" as const,
      },
      {
        rel: "stylesheet",
        href: "https://api.fontshare.com/v2/css?f[]=satoshi@500,700,900&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap",
      },
      { rel: "icon", sizes: "32x32", href: "/assets/favicon-32.png" },
      { rel: "icon", sizes: "16x16", href: "/assets/favicon-16.png" },
      { rel: "apple-touch-icon", href: "/assets/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      ...(favicon ? [{ rel: "icon", href: favicon }] : []),
    ],
  };
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-paper px-6 text-center">
      <p className="readout text-ultra">SIGNAL LOST</p>
      <h1 className="font-display text-5xl font-bold tracking-tighter text-ink">
        404, no page on this channel.
      </h1>
      <Link
        to="/"
        className="frame-hairline mt-2 inline-block border-ultra px-6 py-3 font-meter text-sm text-ultra transition-transform active:scale-[0.98]"
      >
        Back to the console
      </Link>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper px-4">
      <div className="max-w-md text-center">
        <p className="readout text-ultra">FAULT</p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-ink">
          This page didn't load
        </h1>
        <p className="mt-2 text-base leading-relaxed text-ink-soft">
          Something went wrong on our end. Try again or head back to the console.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="border border-ultra bg-ultra px-5 py-2.5 font-meter text-sm text-paper transition-transform active:scale-[0.98]"
          >
            Try again
          </button>
          <a
            href="/"
            className="frame-hairline px-5 py-2.5 font-meter text-sm text-ink transition-transform active:scale-[0.98]"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => buildHead(appMeta),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: "light" }}>
      <head>
        <HeadContent />
      </head>
      <body className="bg-paper font-display text-ink">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Installable, offline-capable PWA: the whole app is static files, so one
  // service worker covers it (see public/sw.js). Production only — caching
  // dev-server chunks would fight Vite's HMR.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
