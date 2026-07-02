// Storm layer randomizer. The bolts' MOTION is pure CSS (storm-strike in
// skin.css, driven by the --storm-* tokens); this module only re-rolls each
// bolt's horizontal position and mirror flip between strikes, so successive
// strikes land somewhere new. It fires on `animationiteration` — the loop
// seam, where the keyframes hold opacity 0 — so the jump is never visible.
//
// Units: the storm SVG's viewBox is 0..100 across, and CSS px in an SVG
// transform are user units, so "8..92px" ≈ 8%..92% of the body width.
//
// Skin-agnostic by construction: when no skin opts in, the layer is
// display:none, the animation never runs, no iteration events fire, and
// this module is inert. No skin check needed.
export function initStorm(): void {
  document.querySelectorAll<SVGPathElement>(".storm__bolt").forEach((bolt) => {
    const roll = () => {
      bolt.style.setProperty("--storm-x", `${Math.round(8 + Math.random() * 84)}px`);
      bolt.style.setProperty("--storm-flip", Math.random() < 0.5 ? "-1" : "1");
    };
    roll(); // scatter the first strikes too, not just subsequent ones
    bolt.addEventListener("animationiteration", roll);
  });
}
