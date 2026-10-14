(() => {
  // The motion monitor (docs/ops/checks/README.md, smooth.mjs). A probe expression for
  // scripts/shots.mjs, not a module: smooth.mjs reads this file and sends it as the first step
  // of each shot. Every frame (rAF) for 14 s, for each watched part, it reads the opacity as
  // painted (its own × its ancestors'; visibility hidden or display none count as 0) and its box.
  //   flash  — fully shown (≥ 0.98), then under 0.85, then fully shown again within 700 ms.
  //   snap   — the opacity rises by 0.6 or more in one frame: a fade-in that skips, or a
  //            fade-out that ends by snapping back (2026-10-14: a flash that runs on from an
  //            intended hide reads as one long dip, so only the snap shows it).
  //   jitter — the box moves 3 px or more and comes back within 1 px inside 250 ms.
  // The findings go to window.__mon; the last step of the shot prints them ("MON {…}").
  // rAF runs before ResizeObserver callbacks, so a layout an observer corrects in the same frame
  // can read as a jitter that never paints: check the shot's frames before calling one real.
  const SEL = [
    ".bento > .panel", ".bento > .panel > *", ".panel__body > *", ".np > *", ".np__center > *",
    ".toast", ".pop:not([hidden])", ".ctx-menu", ".compass", ".hint", ".np__art img", ".panel__title",
  ].join(",");
  const ids = new WeakMap();
  let next = 0;
  const idOf = (e) => (ids.has(e) ? ids.get(e) : (ids.set(e, ++next), next));
  const name = (e) => {
    const slot = e.closest("[data-slot]")?.dataset.slot;
    const c = (e.className && e.className.baseVal === undefined ? e.className : e.tagName).toString().split(" ").filter((x) => x && !x.startsWith("pop-")).slice(0, 2).join(".");
    return (slot ? slot + ":" : "") + (c || e.tagName.toLowerCase());
  };
  const hist = new Map();
  const out = (window.__mon = { flash: [], jitter: [], snap: [], frames: 0 });
  const t0 = performance.now();
  const tick = () => {
    const now = performance.now() - t0;
    out.frames++;
    const cache = new Map();
    const own = (n) => {
      if (cache.has(n)) return cache.get(n);
      const cs = getComputedStyle(n);
      const v = cs.visibility === "hidden" || cs.display === "none" ? 0 : parseFloat(cs.opacity);
      cache.set(n, v);
      return v;
    };
    document.querySelectorAll(SEL).forEach((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return;
      let o = 1;
      for (let n = e; n && n !== document.documentElement; n = n.parentElement) o *= own(n);
      const id = idOf(e);
      let h = hist.get(id);
      if (!h) hist.set(id, (h = { name: name(e), full: -1, low: null, x: r.left, y: r.top, moved: null }));
      if (h.o !== undefined && o - h.o >= 0.6) out.snap.push([Math.round(now), h.name, +h.o.toFixed(2)]);
      h.o = o;
      if (o >= 0.98) {
        if (h.low && now - h.low.t <= 700) out.flash.push([Math.round(h.low.t), h.name, +h.low.o.toFixed(2), Math.round(now - h.low.t)]);
        h.low = null;
        h.full = now;
      } else if (o < 0.85 && h.full >= 0) {
        if (!h.low || o < h.low.o) h.low = { t: h.low ? h.low.t : now, o };
      }
      const dx = r.left - h.x, dy = r.top - h.y;
      if (h.moved) {
        if (Math.abs(r.left - h.moved.x) <= 1 && Math.abs(r.top - h.moved.y) <= 1) {
          if (now - h.moved.t <= 250) out.jitter.push([Math.round(h.moved.t), h.name, Math.round(h.moved.d), Math.round(now - h.moved.t)]);
          h.moved = null;
        } else if (now - h.moved.t > 250) h.moved = null;
      } else if (Math.hypot(dx, dy) >= 3) {
        h.moved = { t: now, x: h.x, y: h.y, d: Math.hypot(dx, dy) };
      }
      h.x = r.left;
      h.y = r.top;
    });
    if (now < 14000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return "monitor armed";
})()
