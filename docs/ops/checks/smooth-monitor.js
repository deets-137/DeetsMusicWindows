(() => {
  // The motion monitor (docs/ops/checks/README.md, smooth.mjs). A probe expression for
  // scripts/shots.mjs, not a module: smooth.mjs reads this file and sends it as the first step
  // of each shot. Every frame (rAF) for 14 s, for each watched part, it reads the opacity as
  // painted (its own × its ancestors'; visibility hidden or display none count as 0) and its box.
  //   flash    — fully shown (≥ 0.98), then under 0.85, then fully shown again within 700 ms.
  //   snap     — the opacity rises by 0.6 or more in one frame: a fade-in that skips, or a
  //              fade-out that ends by snapping back (2026-10-14: a flash that runs on from an
  //              intended hide reads as one long dip, so only the snap shows it).
  //   jitter   — the box moves 3 px or more and comes back within 1 px inside 250 ms.
  //   teleport — (2026-10-19) a shown box (painted opacity ≥ 0.5) moves or changes size by
  //              TELEPORT_PX or more in one frame, after a still frame, and each of the next
  //              two steps is under 1/8 of it: a jump to a new place that stays. A tween moves
  //              in the frames around a step on the same scale, so it never reads as one. The
  //              box judged is the part that shows (cut by the ancestors' overflow and
  //              `inset()` clips), shown in both frames.
  //   rowjump  — (2026-10-19) in each shown scroller, the first row in its visible part (the
  //              box cut by every ancestor's overflow and `inset()` clip) changes in one frame to
  //              a row 3 or more rows away, or the content at the visible top moves by 2.5 rows
  //              or more, after a still frame; each of the next two steps stays near the new
  //              row (under 1/8 of the jump). A scroll moves the rows a little each frame; a
  //              jump shows another part of the list at once.
  // The findings go to window.__mon; the last step of the shot prints them ("MON {…}").
  // rAF runs before ResizeObserver callbacks, so a layout an observer corrects in the same frame
  // can read as a jitter that never paints: check the shot's frames before calling one real.
  const SEL = [
    ".bento > .panel", ".bento > .panel > *", ".panel__body > *", ".np > *", ".np__center > *",
    ".toast", ".pop:not([hidden])", ".ctx-menu", ".compass", ".hint", ".np__art img", ".panel__title",
    // A feature's own parts (QUALITY-SWEEP.md § the visual pass): a step before this one sets
    // `window.__monExtra` to more selectors, and `window.__monMs` to a longer watch than 14 s.
    ...(window.__monExtra ?? []),
  ].join(",");
  // The scrollers: the classes that get the app's scrollbar (styles.css § The app's scrollbar).
  const SCROLL = ".app-scroll, .lib-view, .panel__body, .web, .slot-picker__menu, .ctx-menu__fly, .spane__scroll, .search__scroller, .qcard__list";
  const WATCH_MS = window.__monMs ?? 14000;
  const TELEPORT_PX = 24; // a 300 ms tween at 60 Hz steps ~35 px, but never after a still frame
  const STILL_PX = 1;
  // After a jump the box may go on a little (a clip that keeps cropping: the stacked open of
  // 2026-10-18). Each of the next two steps under this share of the jump counts as staying.
  const AFTER_SHARE = 1 / 8;
  const ids = new WeakMap();
  let next = 0;
  const idOf = (e) => (ids.has(e) ? ids.get(e) : (ids.set(e, ++next), next));
  const name = (e) => {
    const slot = e.closest("[data-slot]")?.dataset.slot;
    const c = (e.className && e.className.baseVal === undefined ? e.className : e.tagName).toString().split(" ").filter((x) => x && !x.startsWith("pop-")).slice(0, 2).join(".");
    return (slot ? slot + ":" : "") + (c || e.tagName.toLowerCase());
  };
  const hist = new Map();
  const rows = new Map();
  const out = (window.__mon = { flash: [], jitter: [], snap: [], teleport: [], rowjump: [], frames: 0 });
  const t0 = performance.now();
  const box = (r) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`;
  // `inset(a b c d round …)` as px edges; a percent is of the box. Anything else is not a cut.
  const insetOf = (cs, r) => {
    const m = /^inset\(([^)]*)\)/.exec(cs.clipPath || "");
    if (!m) return null;
    const parts = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/);
    const v = (s, of) => (s.endsWith("%") ? (parseFloat(s) / 100) * of : parseFloat(s) || 0);
    const [t, rr = t, b = t, l = rr] = parts;
    return { top: r.top + v(t, r.height), right: r.right - v(rr, r.width), bottom: r.bottom - v(b, r.height), left: r.left + v(l, r.width) };
  };
  const cut = (a, b) => ({ top: Math.max(a.top, b.top), left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const asBox = (v) => ({ left: v.left, top: v.top, width: Math.max(0, v.right - v.left), height: Math.max(0, v.bottom - v.top) });
  // The first child whose bottom is under `top` (children in DOM order are in reading order;
  // a long list is searched by halves).
  const firstUnder = (kids, top) => {
    let lo = 0, hi = kids.length - 1, hit = -1;
    if (kids.length <= 32) {
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (r.height && r.bottom > top + 1) return i;
      }
      return -1;
    }
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (kids[mid].getBoundingClientRect().bottom > top + 1) (hit = mid), (hi = mid - 1);
      else lo = mid + 1;
    }
    return hit;
  };
  const keyed = (e) => e.dataset && (e.dataset.idx ?? e.dataset.id ?? e.dataset.key ?? e.dataset.trackId ?? e.dataset.albumId);
  // Down from the scroller to the first row in view: a keyed element, a leaf, or a box a row high.
  const firstRow = (sc, top) => {
    let n = sc;
    for (let depth = 0; depth < 8; depth++) {
      const kids = [...n.children].filter((k) => k.tagName !== "TEMPLATE" && k.tagName !== "STYLE");
      const i = firstUnder(kids, top);
      if (i < 0) return n === sc ? null : { el: n, index: 0, parent: n.parentElement };
      const k = kids[i];
      const r = k.getBoundingClientRect();
      if (keyed(k) !== undefined || !k.children.length || r.height <= 96) return { el: k, index: i, parent: n, h: r.height };
      n = k;
    }
    return { el: n, index: 0, parent: n.parentElement };
  };
  const rowKey = (e) => {
    const k = keyed(e);
    const t = (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 32);
    return k !== undefined ? `#${k} ${t}` : t || e.tagName.toLowerCase();
  };
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
    // Where a node's content shows: its own `inset()` and overflow cut, inside its parent's.
    // A changed `inset()` moves what shows, and rAF reads the frame's own value (an animated
    // clip-path's computed value is its value now).
    const view = { top: 0, left: 0, right: innerWidth, bottom: innerHeight };
    const clips = new Map();
    const selfCut = (n, r, cs) => {
      const c = insetOf(cs, r);
      return c ? cut(r, c) : r;
    };
    const inner = (n) => {
      if (!n || n === document.documentElement) return view;
      if (clips.has(n)) return clips.get(n);
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      let v = inner(n.parentElement);
      const c = insetOf(cs, r);
      if (c) v = cut(v, c);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") v = cut(v, r);
      clips.set(n, v);
      return v;
    };
    // The part of a box that shows (an approximation: a box that escapes a clipping ancestor
    // through its containing block still counts as cut).
    const shown = (e, r) => cut(selfCut(e, r, getComputedStyle(e)), inner(e.parentElement));
    document.querySelectorAll(SEL).forEach((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const vis = asBox(shown(e, r)); // teleport judges what shows; the other checks the box
      let o = 1;
      for (let n = e; n && n !== document.documentElement; n = n.parentElement) o *= own(n);
      const id = idOf(e);
      let h = hist.get(id);
      if (!h) hist.set(id, (h = { name: name(e), full: -1, low: null, x: r.left, y: r.top, w: r.width, h: r.height, moved: null, step: Infinity, tp: null, vis: null }));
      if (h.o !== undefined && o - h.o >= 0.6) out.snap.push([Math.round(now), h.name, +h.o.toFixed(2)]);
      const oBefore = h.o ?? o;
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
      // Teleport: one big step of the part that shows, between still frames, shown in both.
      const seen = vis.width >= 1 && vis.height >= 1 && Math.min(o, oBefore) >= 0.5;
      const step = !seen || !h.vis ? Infinity
        : Math.max(Math.abs(vis.left - h.vis.left), Math.abs(vis.top - h.vis.top), Math.abs(vis.width - h.vis.width), Math.abs(vis.height - h.vis.height));
      if (h.tp) {
        if (step <= Math.max(STILL_PX, h.tp.d * AFTER_SHARE)) {
          if (++h.tp.still >= 2) {
            out.teleport.push([Math.round(h.tp.t), h.name, Math.round(h.tp.d), h.tp.from, h.tp.to]);
            h.tp = null;
          }
        } else h.tp = null;
      } else if (step >= TELEPORT_PX && step !== Infinity && h.step <= STILL_PX) {
        h.tp = { t: now, d: step, still: 0, from: box(h.vis), to: box(vis) };
      }
      h.step = step;
      h.vis = seen ? vis : null;
      h.x = r.left;
      h.y = r.top;
      h.w = r.width;
      h.h = r.height;
    });
    // Row jumps: the first row in view of each shown scroller.
    document.querySelectorAll(SCROLL).forEach((sc) => {
      const r = sc.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const v = inner(sc);
      let o = 1;
      for (let n = sc; n && n !== document.documentElement; n = n.parentElement) o *= own(n);
      if (o < 0.5 || v.bottom - v.top < 8 || v.right - v.left < 8) return;
      const row = firstRow(sc, v.top);
      if (!row) return;
      const id = idOf(sc);
      const key = rowKey(row.el);
      const y = v.top - r.top + sc.scrollTop; // the content's y at the visible top
      const h = rows.get(id);
      if (!h) return void rows.set(id, { name: name(sc), key, index: row.index, parent: row.parent, y, rowH: row.h || 40, step: Infinity, jp: null });
      const rowH = Math.max(16, row.h || h.rowH);
      const far = h.parent === row.parent ? Math.abs(row.index - h.index) >= 3 : key !== h.key;
      const moved = Math.abs(y - h.y);
      const changed = key !== h.key || moved > STILL_PX;
      if (h.jp) {
        if (!far && moved <= Math.max(STILL_PX, Math.abs(h.jp.dy) * AFTER_SHARE)) {
          if (++h.jp.still >= 2) {
            out.rowjump.push([Math.round(h.jp.t), h.name, h.jp.from, h.jp.to, Math.round(h.jp.dy)]);
            h.jp = null;
          }
        } else h.jp = null;
      } else if (key !== h.key && (far || moved >= 2.5 * rowH) && h.step === 0) {
        h.jp = { t: now, from: h.key, to: key, dy: y - h.y, still: 0 };
      }
      h.step = changed ? 1 : 0;
      Object.assign(h, { key, index: row.index, parent: row.parent, y, rowH });
    });
    if (now < WATCH_MS) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return "monitor armed";
})()
