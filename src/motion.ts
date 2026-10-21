// Is motion reduced? (GRAPHICS-FALLBACK.md §10.4.) One answer for every animation in the app:
// Windows' reduced motion, the Settings › Motion › Reduce motion row, or the graphics rule while
// the window draws in software. src/reduce-motion.ts sets `data-motion="reduced"` on <html>
// (index.html's pre-paint sets it first, from Windows and the row); styles.css keys every
// reduced rule on it. Call this, never `matchMedia("(prefers-reduced-motion…")`: that one hears
// Windows only (docs:check 32).
//
// No imports, so any module can read it.

export function motionReduced(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.motion === "reduced";
}
