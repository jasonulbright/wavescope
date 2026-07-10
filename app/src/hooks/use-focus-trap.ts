import { useEffect, useRef } from "react";

/**
 * Trap keyboard focus inside an overlay while it is open, and restore focus to
 * whatever was focused before it opened when it closes. Tab / Shift+Tab cycle
 * within the container; focus can't escape to the deck behind a modal. Escape
 * is left to the caller (each overlay already handles its own close).
 *
 * Returns a ref to put on the overlay's container element.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move focus into the overlay on open (first focusable, else the container).
    const first = focusable()[0];
    (first ?? container).focus?.();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && activeEl === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && activeEl === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger when the overlay closes.
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
