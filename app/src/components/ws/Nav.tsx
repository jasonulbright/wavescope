import { Link } from "@tanstack/react-router";

/** Single-line nav, under 80px, brand left, two links + launch right. */
export function Nav() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-ink/10 bg-paper/90 px-4 backdrop-blur md:px-8">
      <Link to="/" className="flex items-center gap-3">
        <img src="/assets/monogram.webp" alt="WaveScope monogram" className="h-7 w-7" />
        <span className="font-display text-lg font-bold tracking-tight text-ink">
          WaveScope
        </span>
      </Link>
      <nav className="flex items-center gap-6">
        <Link
          to="/docs"
          className="font-meter text-sm text-ink-soft transition-colors hover:text-ink"
        >
          Manual
        </Link>
        <Link
          to="/viz"
          className="group relative hidden overflow-hidden border border-ultra px-4 py-2 font-meter text-xs text-ultra transition-transform active:scale-[0.98] sm:inline-block"
        >
          <span className="absolute inset-0 -translate-x-full bg-ultra transition-transform duration-300 ease-out group-hover:translate-x-0" />
          <span className="relative transition-colors duration-300 group-hover:text-paper">
            Launch WaveScope
          </span>
        </Link>
      </nav>
    </header>
  );
}
