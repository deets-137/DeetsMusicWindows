// Artwork self-healing — recover cover <img>s whose load failed to a transient network
// drop (sleep/wake, a Wi-Fi blip). Covers are direct <img src> to Apple's CDN with no
// retry of their own, so a request killed in flight (e.g. the machine suspends mid-fetch)
// leaves a broken tile until the node is recreated — and Chromium negative-caches the
// failure, so even a re-render can re-serve the error. This installs ONE capture-phase
// error listener (image load errors don't bubble, so capture is required) that retries
// with backoff + a cache-bust, plus a resume sweep on focus/visibility that re-kicks any
// cover that's still broken after the app comes back to the foreground.
//
// Opt-in marker: every artwork <img> carries `data-art`. Icons are inline SVG, so there
// are no other <img>s today; the marker keeps this scoped and means we never rewrite a
// src we didn't originate.

// Retry budget per element and the backoff step. These are network constants (not visual
// motion), so they live here rather than as skin tokens. 1st retry ~400ms, then 800, 1200.
const MAX_RETRIES = 3;
const RETRY_STEP_MS = 400;

// Re-point an <img> at its source with a fresh cache-bust param so Chromium can't hand
// back the negatively-cached failure. The clean base URL is captured once into
// `data-art-src` (the initial `src` is always bust-free) and every retry rebuilds from it.
function rekick(img: HTMLImageElement) {
  const base = (img.dataset.artSrc ??= img.src);
  const sep = base.includes("?") ? "&" : "?";
  img.src = `${base}${sep}_r=${Date.now()}`;
}

const isArtImg = (t: EventTarget | null): t is HTMLImageElement =>
  t instanceof HTMLImageElement && t.hasAttribute("data-art");

// A cover whose load has settled unsuccessfully: finished, but zero intrinsic size.
const isBroken = (img: HTMLImageElement) => img.complete && img.naturalWidth === 0;

function onError(e: Event) {
  const img = e.target;
  if (!isArtImg(img)) return;
  const n = Number(img.dataset.artRetry ?? "0");
  if (n >= MAX_RETRIES) return; // genuinely dead URL (404) — stop after the budget
  img.dataset.artRetry = String(n + 1);
  setTimeout(() => rekick(img), RETRY_STEP_MS * (n + 1));
}

// A successful load clears the counter, so a later failure (a fresh sleep cycle) gets a
// full retry budget again even without a focus change in between.
function onLoad(e: Event) {
  const img = e.target;
  if (isArtImg(img) && img.dataset.artRetry) delete img.dataset.artRetry;
  if (img instanceof HTMLImageElement && img.hasAttribute("data-art-wait")) arrive(img);
}

// ── Late covers (UX-COVERUPS.md §7.3) ─────────────────────────────────────────
// One rule for the whole app: a cover that was not complete when it was put in the page
// waits on its slot's ground (`data-art-wait`, opacity 0 in styles.css) and fades in over
// `--art-in` when it loads; a complete one shows at once. The mark is set by a
// MutationObserver, whose callback runs before the next paint, so a cover that is still on
// its way never shows half drawn. A failed cover stays on the ground while it is retried.
// `data-fade` takes a picture that is not Apple's (a drawn mosaic, a blob) into the same
// fade without the retry. A card set to instant (Cover load animations off, 7.12, his W2 B)
// carries `data-instant`: its covers show the frame they load, as before.

const FADE_SEL = "img[data-art], img[data-fade]";
const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const lateHooks = new Set<(img: HTMLImageElement) => void>();
/** Hear each late cover as it arrives (reveal.ts logs `reveal:late`). */
export function onLateArt(fn: (img: HTMLImageElement) => void): () => void {
  lateHooks.add(fn);
  return () => lateHooks.delete(fn);
}

function arrive(img: HTMLImageElement): void {
  img.removeAttribute("data-art-wait");
  lateHooks.forEach((fn) => fn(img));
  // Held for its section's wave (Search, reveal.ts `revealPictures`): the wave fades it.
  if (img.hasAttribute("data-art-held")) return;
  if (reduced() || img.closest("[data-instant]")) return;
  img.classList.add("art-in");
  img.addEventListener("animationend", () => img.classList.remove("art-in"), { once: true });
}

function watchAdded(list: MutationRecord[]): void {
  for (const m of list) {
    for (const n of m.addedNodes) {
      if (!(n instanceof Element)) continue;
      const imgs = n.matches(FADE_SEL) ? [n as HTMLImageElement] : [];
      if (n.firstElementChild) imgs.push(...n.querySelectorAll<HTMLImageElement>(FADE_SEL));
      for (const img of imgs) {
        if (img.complete && img.naturalWidth > 0) continue;
        if (!img.getAttribute("src")) continue;
        img.setAttribute("data-art-wait", "");
      }
    }
  }
}

// On resume, give every still-broken cover a fresh budget and one immediate re-kick; if
// that attempt also fails, onError takes over with its backoff.
let sweepTimer: number | undefined;
function sweep() {
  document.querySelectorAll<HTMLImageElement>("img[data-art]").forEach((img) => {
    if (!isBroken(img)) return;
    img.dataset.artRetry = "0";
    rekick(img);
  });
}
function scheduleSweep() {
  if (document.visibilityState === "hidden") return; // wait until we're actually foreground
  clearTimeout(sweepTimer);
  sweepTimer = window.setTimeout(sweep, 150); // debounce focus + visibilitychange double-fire
}

let installed = false;
export function initArtworkHeal() {
  if (installed) return; // idempotent — safe if called more than once
  installed = true;
  document.addEventListener("error", onError, true); // capture: img errors don't bubble
  document.addEventListener("load", onLoad, true);
  document.addEventListener("visibilitychange", scheduleSweep);
  window.addEventListener("focus", scheduleSweep);
  new MutationObserver(watchAdded).observe(document.documentElement, { childList: true, subtree: true });
}
