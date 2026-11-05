// Storm layer randomizer. The strikes' MOTION is pure CSS (storm-strike /
// storm-hold in skin.css, driven by the --storm-* tokens); this module only
// re-rolls each bolt's horizontal position and mirror flip between strikes, so
// successive strikes land somewhere new. It fires on the strike box's
// `animationiteration` — the loop seam, where the keyframes hold opacity 0 — so
// the jump is never visible. The inner hold box runs the same cycle and its own
// iteration event bubbles up; that one is ignored.
//
// Units: the storm SVG's viewBox is 0..100 across, and CSS px in an SVG
// transform are user units, so "8..92px" ≈ 8%..92% of the body width. The
// properties are set on the strike box and inherited by its bolt.
//
// Skin-agnostic by construction: when no skin opts in, the layer is
// display:none, the animation never runs, no iteration events fire, and
// this module is inert. No skin check needed.
/** The album's secondary color (album-light.ts) on one bolt. A bolt takes it only while dark, so
 *  it never changes in view. */
function takeAlbum(strike: HTMLElement): void {
  const album = document.documentElement.style.getPropertyValue("--album-neon-2");
  if (album) strike.style.setProperty("--storm-album", album);
  else strike.style.removeProperty("--storm-album");
}

/** The roles changed: every bolt that is dark now takes them. A lit one waits for its seam. */
export function stormTakeAlbum(): void {
  document.querySelectorAll<HTMLElement>(".storm__strike").forEach((strike) => {
    if (getComputedStyle(strike).opacity === "0") takeAlbum(strike);
  });
}

export function initStorm(): void {
  document.querySelectorAll<HTMLElement>(".storm__strike").forEach((strike) => {
    const roll = () => {
      strike.style.setProperty("--storm-x", `${Math.round(8 + Math.random() * 84)}px`);
      strike.style.setProperty("--storm-flip", Math.random() < 0.5 ? "-1" : "1");
      takeAlbum(strike);
    };
    roll(); // scatter the first strikes too, not just subsequent ones
    strike.addEventListener("animationiteration", (e) => {
      if (e.target === strike) roll();
    });
  });
}
