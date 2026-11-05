// Records what the album wave did on the dev app (ALBUM-COLOR.md § The album light).
// `node scripts/webview-eval.mjs "$(cat docs/ops/checks/album-wave-probe.mjs)"` arms it; the next
// song change fills window.__wave: each frame's gap, the front's place, the copies, the ends.
(() => {
  const w = (window.__wave = { frames: [], added: 0, removed: 0, cards: 0, maxGap: 0, leftover: null, roleAtStart: "", roleAtEnd: "" });
  const root = document.documentElement;
  const bento = document.querySelector(".bento");
  const mo = new MutationObserver((rs) => {
    for (const r of rs) {
      r.addedNodes.forEach((n) => {
        if (n.classList?.contains("album-wave")) {
          w.added++;
          w.cards = n.querySelectorAll(".album-wave__wheel").length;
          w.roleAtStart = root.style.getPropertyValue("--album-neon-bloom");
          w.waveRole = n.style.getPropertyValue("--album-neon-bloom");
          w.t0 = performance.now();
          let last = w.t0;
          const tick = (t) => {
            const strike = n.querySelector(".album-wave__strike");
            if (!n.isConnected || !strike) return;
            const m = new DOMMatrix(getComputedStyle(strike).transform);
            const h = new DOMMatrix(getComputedStyle(strike.firstChild).transform);
            const gap = t - last;
            last = t;
            w.maxGap = Math.max(w.maxGap, gap);
            const net = m.multiply(h);
            w.frames.push({ t: Math.round(t - w.t0), deg: Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI), drift: Math.round((Math.abs(net.e) + Math.abs(net.f)) * 100) / 100 });
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      });
      r.removedNodes.forEach((n) => {
        if (n.classList?.contains("album-wave")) {
          w.removed++;
          w.ms = Math.round(performance.now() - w.t0);
          w.roleAtEnd = root.style.getPropertyValue("--album-neon-bloom");
          w.leftover = document.querySelectorAll(".album-wave").length;
        }
      });
    }
  });
  mo.observe(bento, { childList: true });
  return "armed";
})()
