/**
 * Motion constants for JavaScript-driven animations (WAAPI). They mirror the
 * CSS tokens in `shared/styles/globals.css` (`--ease-out`, `--duration-*`)
 * so scripted motion matches CSS motion without reading styles at runtime.
 */
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

/** True when the OS asks for reduced motion (false where matchMedia is missing). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}
