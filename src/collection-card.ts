// Collection card — a navigable, context-aware browser shared by the Library and
// Playlists cards. The card shows a stack of "contexts" (Library → Artist → Album,
// or Playlists → Playlist). Each context declares its own groupings, each grouping
// its own sort keys + how to render and (optionally) drill into a child context.
//
// Navigation is a horizontal PUSH stack: drilling in slides the current pane out to
// the left while the child slides in from the right to fill the card; backing out
// reverses it. The card header (back chevron + title) is fixed chrome; only the
// body (toolbar + list) slides. The transition's feel is skin-tokened
// (--nav-dur / --nav-ease) and honours prefers-reduced-motion.
//
// Everything is client-side over data the card already holds in memory.

export type Density = "lines" | "small" | "large";
export type SortDir = "asc" | "desc";

export interface SortSpec<T = any> {
  key: string;
  label: string;
  get: (x: T) => string | number | undefined; // undefined sinks to the bottom
  type: "str" | "num";
}

export interface Grouping<T = any> {
  key: string;
  label: string;
  sorts: SortSpec<T>[];
  list: () => T[]; // live accessor — recomputed each render so syncs flow through
  name: (x: T) => string; // search tiebreak + (for details) the drilled title
  match: (x: T, q: string) => boolean;
  render: (x: T, density: Density, idx: number) => string; // root el must carry data-idx="${idx}"
  open?: (x: T) => Context | null; // drill target, or null for a leaf (e.g. a song)
  // Leaf action on click (e.g. play a song). Takes precedence over `open`, and gets the
  // current sorted view + index so it can act on "everything from here onward".
  activate?: (x: T, index: number, items: T[]) => void;
}

export interface Context {
  title: string;
  groupings: Grouping[]; // >= 1; >1 → View shows a grouping column
  density: boolean; // whether the density column applies
  defaults?: { grouping?: string; density?: Density; sortKey?: string; sortDir?: SortDir };
}

export interface CardOptions {
  root: HTMLElement; // the .panel element (must hold .panel__title, .panel__back, .coll-body)
  storeKey: string; // localStorage key for the top-level prefs
  rootContext: () => Context; // built fresh from current data
}

interface Frame {
  ctx: Context;
  grouping: string;
  density: Density;
  sortKey: string;
  sortDir: SortDir;
  query: string;
  searchOpen: boolean;
  items: any[]; // current view order, for tile-click index → item
  scroll: number; // remembered scroll position, restored on back
}

// ── helpers ───────────────────────────────────────────────────────────────────
export const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }) as Record<string, string>)[c]);

const cmpStr = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

function sortItems<T>(items: T[], spec: SortSpec<T>, dir: SortDir, nameOf: (x: T) => string): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => cmpStr(nameOf(a), nameOf(b));
  return [...items].sort((a, b) => {
    const va = spec.get(a);
    const vb = spec.get(b);
    if (va == null && vb == null) return byName(a, b);
    if (va == null) return 1; // missing always last, either direction
    if (vb == null) return -1;
    const c = spec.type === "num" ? (va as number) - (vb as number) : cmpStr(String(va), String(vb));
    return sign * c || byName(a, b);
  });
}

// ── controller ──────────────────────────────────────────────────────────────────
export function initCollectionCard(opts: CardOptions) {
  const titleEl = opts.root.querySelector<HTMLElement>(".panel__title");
  const backEl = opts.root.querySelector<HTMLButtonElement>(".panel__back");
  const bodyHost = opts.root.querySelector<HTMLElement>(".coll-body");
  if (!bodyHost) return { reload: () => {} };

  const baseTitle = titleEl?.textContent ?? "";
  bodyHost.innerHTML = `<div class="coll-viewport" data-viewport></div>`;
  const viewport = bodyHost.querySelector<HTMLElement>("[data-viewport]")!;

  const stack: Frame[] = [];
  let curPane: HTMLElement | null = null;
  let animating = false;

  const cur = () => stack[stack.length - 1];
  const groupingOf = (f: Frame) => f.ctx.groupings.find((g) => g.key === f.grouping)!;

  const frameFor = (ctx: Context, isTop: boolean): Frame => {
    const d = ctx.defaults ?? {};
    const g = ctx.groupings.find((x) => x.key === d.grouping) ?? ctx.groupings[0];
    const f: Frame = {
      ctx,
      grouping: g.key,
      density: d.density ?? "lines",
      sortKey: d.sortKey ?? g.sorts[0].key,
      sortDir: d.sortDir ?? "asc",
      query: "",
      searchOpen: false,
      items: [],
      scroll: 0,
    };
    if (isTop) {
      try {
        const raw = localStorage.getItem(opts.storeKey);
        if (raw) {
          const s = JSON.parse(raw);
          if (ctx.groupings.some((x) => x.key === s.grouping)) f.grouping = s.grouping;
          const ag = ctx.groupings.find((x) => x.key === f.grouping)!;
          if (ag.sorts.some((x) => x.key === s.sortKey)) f.sortKey = s.sortKey;
          if (s.sortDir === "asc" || s.sortDir === "desc") f.sortDir = s.sortDir;
          if (["lines", "small", "large"].includes(s.density)) f.density = s.density;
        }
      } catch {
        /* ignore corrupt prefs */
      }
    }
    return f;
  };

  const persist = () => {
    if (stack.length !== 1) return; // only the top level persists
    const { grouping, density, sortKey, sortDir } = cur();
    try {
      localStorage.setItem(opts.storeKey, JSON.stringify({ grouping, density, sortKey, sortDir }));
    } catch {
      /* storage unavailable */
    }
  };

  // ── markup builders (pure; take a frame) ──
  const sortPopBody = (f: Frame) => {
    const g = groupingOf(f);
    const keys = g.sorts
      .map(
        (s) =>
          `<button class="lib-pop__opt${s.key === f.sortKey ? " is-active" : ""}" type="button" data-sort-key="${s.key}">${esc(
            s.label,
          )}</button>`,
      )
      .join("");
    const dirs = (["asc", "desc"] as SortDir[])
      .map(
        (d) =>
          `<button class="lib-pop__dir${d === f.sortDir ? " is-active" : ""}" type="button" data-sort-dir="${d}" aria-label="${
            d === "asc" ? "Ascending" : "Descending"
          }"><svg viewBox="0 0 12 12" aria-hidden="true">${
            d === "asc" ? '<path d="M6 10V2M3 5l3-3 3 3" />' : '<path d="M6 2v8M3 7l3 3 3-3" />'
          }</svg></button>`,
      )
      .join("");
    return `<div class="lib-pop__cols"><div class="lib-pop__col" role="group" aria-label="Sort by">${keys}</div><div class="lib-pop__col lib-pop__col--dir" role="group" aria-label="Direction">${dirs}</div></div>`;
  };

  const viewPopBody = (f: Frame) => {
    const ctx = f.ctx;
    const groupCol =
      ctx.groupings.length > 1
        ? `<div class="lib-pop__col" role="group" aria-label="Group by">${ctx.groupings
            .map(
              (g) =>
                `<button class="lib-pop__opt${g.key === f.grouping ? " is-active" : ""}" type="button" data-group="${g.key}">${esc(
                  g.label,
                )}</button>`,
            )
            .join("")}</div>`
        : "";
    const dIcon: Record<Density, string> = {
      lines: '<path d="M2 4h12M2 8h12M2 12h12" />',
      small:
        '<g fill="currentColor" stroke="none"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></g>',
      large: '<rect x="2" y="2" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
    };
    const densCol = ctx.density
      ? `<div class="lib-pop__col lib-pop__col--dir" role="group" aria-label="Density">${(["lines", "small", "large"] as Density[])
          .map(
            (d) =>
              `<button class="lib-pop__dir${d === f.density ? " is-active" : ""}" type="button" data-density="${d}" aria-label="${d}"><svg viewBox="0 0 16 16" aria-hidden="true">${dIcon[d]}</svg></button>`,
          )
          .join("")}</div>`
      : "";
    return `<div class="lib-pop__cols">${groupCol}${densCol}</div>`;
  };

  const toolbarHTML = (f: Frame) => {
    const showView = f.ctx.groupings.length > 1 || f.ctx.density;
    return `
      <div class="lib-toolbar">
        <div class="lib-pills">
          <div class="lib-ctrl" data-ctrl="sort">
            <button class="lib-pill" data-pop="sort" type="button" aria-haspopup="true" aria-expanded="false">
              <span class="lib-pill__label">Sort</span>
              <svg class="lib-pill__caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
            </button>
            <div class="lib-pop" data-popbody="sort" role="menu" aria-label="Sort" hidden>${sortPopBody(f)}</div>
          </div>
          ${
            showView
              ? `<div class="lib-ctrl" data-ctrl="view">
            <button class="lib-pill" data-pop="view" type="button" aria-haspopup="true" aria-expanded="false">
              <span class="lib-pill__label">View</span>
              <svg class="lib-pill__caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
            </button>
            <div class="lib-pop" data-popbody="view" role="menu" aria-label="View" hidden>${viewPopBody(f)}</div>
          </div>`
              : ""
          }
          <div class="lib-ctrl" data-ctrl="search">
            <button class="lib-pill lib-pill--icon${f.query ? " is-active" : ""}" data-pop="search" type="button" aria-expanded="${f.searchOpen}" aria-label="Search">
              <svg class="lib-pill__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>
            </button>
          </div>
        </div>
        <div class="lib-searchbar${f.searchOpen ? " is-open" : ""}">
          <div class="lib-searchbar__inner">
            <label class="lib-search">
              <svg class="lib-search__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>
              <input class="lib-search__input" data-search type="search" placeholder="Search…" autocomplete="off" spellcheck="false" />
            </label>
          </div>
        </div>
      </div>`;
  };

  const buildPane = (f: Frame): HTMLElement => {
    const pane = document.createElement("div");
    pane.className = "coll-pane";
    pane.dataset.pos = "center";
    pane.innerHTML = `${toolbarHTML(f)}<div class="lib-view" data-view></div>`;
    const input = pane.querySelector<HTMLInputElement>("[data-search]");
    if (input) input.value = f.query;
    renderViewInto(pane, f);
    return pane;
  };

  const renderViewInto = (pane: HTMLElement, f: Frame) => {
    const view = pane.querySelector<HTMLElement>("[data-view]");
    if (!view) return;
    const g = groupingOf(f);
    const q = f.query.trim().toLowerCase();
    let items = g.list();
    if (q) items = items.filter((x) => g.match(x, q));
    const spec = g.sorts.find((s) => s.key === f.sortKey) ?? g.sorts[0];
    items = sortItems(items, spec, f.sortDir, g.name);
    f.items = items;

    view.dataset.grid = f.density; // CSS hook for column sizing (NOT data-density —
    view.dataset.openable = g.open ? "1" : ""; // that collides with the density buttons)
    if (!items.length) {
      view.className = "lib-view lib-empty";
      view.innerHTML = `<p class="lib-empty__msg">${f.query ? "No matches." : "Nothing here yet."}</p>`;
      return;
    }
    view.className = f.density === "lines" ? "lib-view lib-list" : "lib-view lib-grid";
    view.innerHTML = items.map((x, i) => g.render(x, f.density, i)).join("");
    // scroll restore / highlight scrolling is done post-mount in applyScroll()
  };

  const setHeader = (isTop: boolean, title: string) => {
    if (titleEl) titleEl.textContent = isTop ? baseTitle : title;
    if (backEl) backEl.hidden = isTop;
  };

  // ── transition (push / pop) ──
  // Restore scroll once the pane is in the DOM and laid out (doing it while the
  // pane is detached silently no-ops). A highlighted item wins over saved scroll.
  const applyScroll = (pane: HTMLElement, f: Frame) => {
    const v = pane.querySelector<HTMLElement>("[data-view]");
    if (!v) return;
    const sel = v.querySelector(".is-selected");
    if (sel) sel.scrollIntoView({ block: "center" });
    else v.scrollTop = f.scroll;
  };

  const slide = (incoming: HTMLElement, dir: "push" | "pop", frame: Frame, onDone?: () => void) => {
    animating = true;
    const outgoing = curPane;
    incoming.dataset.pos = dir === "push" ? "right" : "left";
    incoming.style.transition = "none"; // place off-screen without animating
    viewport.appendChild(incoming);
    void incoming.offsetWidth; // force reflow so the start position is committed
    applyScroll(incoming, frame); // now laid out → scroll sticks
    incoming.style.transition = "";
    incoming.dataset.pos = "center";
    if (outgoing) outgoing.dataset.pos = dir === "push" ? "left" : "right";
    curPane = incoming;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      incoming.removeEventListener("transitionend", finish);
      if (outgoing) outgoing.remove();
      animating = false;
      onDone?.();
    };
    const durStr = getComputedStyle(incoming).transitionDuration;
    const durMs = (parseFloat(durStr) || 0) * (durStr.includes("ms") ? 1 : 1000);
    if (durMs <= 0) finish();
    else {
      incoming.addEventListener("transitionend", finish);
      setTimeout(finish, durMs + 80); // safety net if transitionend is missed
    }
  };

  const drill = (childCtx: Context) => {
    if (animating) return;
    // remember where we were so back restores scroll
    const v = curPane?.querySelector<HTMLElement>("[data-view]");
    if (v) cur().scroll = v.scrollTop;
    const f = frameFor(childCtx, false);
    stack.push(f);
    setHeader(false, f.ctx.title);
    slide(buildPane(f), "push", f);
  };

  const back = () => {
    if (animating || stack.length <= 1) return;
    const prev = stack[stack.length - 2];
    setHeader(stack.length - 1 === 1, prev.ctx.title);
    slide(buildPane(prev), "pop", prev, () => stack.pop());
  };

  backEl?.addEventListener("click", back);

  // ── delegated interactions (scoped to the current, on-screen pane) ──
  const closePops = () => {
    curPane?.querySelectorAll<HTMLElement>("[data-popbody]").forEach((p) => (p.hidden = true));
    curPane?.querySelectorAll<HTMLElement>("[data-pop]").forEach((b) => b.setAttribute("aria-expanded", "false"));
  };
  const markSearchPill = () => {
    curPane?.querySelector('[data-pop="search"]')?.classList.toggle("is-active", !!cur().query);
  };
  const refreshActive = (kind: "sort-key" | "sort-dir" | "density" | "group", val: string) => {
    const attr = { "sort-key": "data-sort-key", "sort-dir": "data-sort-dir", density: "data-density", group: "data-group" }[kind];
    curPane?.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => el.classList.toggle("is-active", el.getAttribute(attr) === val));
  };

  viewport.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const pane = t.closest<HTMLElement>(".coll-pane");
    if (!pane || pane !== curPane || animating) return; // ignore off-screen / mid-transition panes

    const pop = t.closest<HTMLElement>("[data-pop]");
    if (pop) {
      e.stopPropagation();
      const which = pop.dataset.pop!;
      if (which === "search") {
        const open = !cur().searchOpen;
        closePops();
        cur().searchOpen = open;
        pane.querySelector(".lib-searchbar")?.classList.toggle("is-open", open);
        pop.setAttribute("aria-expanded", String(open));
        if (open) pane.querySelector<HTMLInputElement>("[data-search]")?.focus();
        return;
      }
      const target = pane.querySelector<HTMLElement>(`[data-popbody="${which}"]`);
      const willOpen = !!target?.hidden;
      closePops();
      if (target && willOpen) {
        target.hidden = false;
        pop.setAttribute("aria-expanded", "true");
      }
      return;
    }

    const sk = t.closest<HTMLElement>("[data-sort-key]");
    if (sk) {
      cur().sortKey = sk.dataset.sortKey!;
      persist();
      refreshActive("sort-key", sk.dataset.sortKey!);
      renderViewInto(pane, cur());
      return;
    }
    const sd = t.closest<HTMLElement>("[data-sort-dir]");
    if (sd) {
      cur().sortDir = sd.dataset.sortDir as SortDir;
      persist();
      refreshActive("sort-dir", sd.dataset.sortDir!);
      renderViewInto(pane, cur());
      return;
    }
    const dn = t.closest<HTMLElement>("[data-density]");
    if (dn) {
      cur().density = dn.dataset.density as Density;
      persist();
      refreshActive("density", dn.dataset.density!);
      renderViewInto(pane, cur());
      return;
    }
    const gr = t.closest<HTMLElement>("[data-group]");
    if (gr) {
      const f = cur();
      f.grouping = gr.dataset.group!;
      const g = groupingOf(f);
      if (!g.sorts.some((s) => s.key === f.sortKey)) f.sortKey = g.sorts[0].key;
      f.scroll = 0;
      persist();
      const sb = pane.querySelector<HTMLElement>('[data-popbody="sort"]'); // sorts differ per grouping
      if (sb) sb.innerHTML = sortPopBody(f);
      refreshActive("group", f.grouping);
      renderViewInto(pane, f);
      return;
    }

    // a tile/row → activate the leaf (play) if it offers one, else drill in
    const item = t.closest<HTMLElement>("[data-idx]");
    if (item) {
      const g = groupingOf(cur());
      const idx = Number(item.dataset.idx);
      const x = cur().items[idx];
      if (!x) return;
      if (g.activate) {
        g.activate(x, idx, cur().items);
        return;
      }
      if (g.open) {
        const child = g.open(x);
        if (child) drill(child);
      }
    }
  });

  viewport.addEventListener("input", (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>("[data-search]");
    if (!input) return;
    const pane = input.closest<HTMLElement>(".coll-pane");
    if (pane !== curPane) return;
    cur().query = input.value;
    cur().scroll = 0;
    markSearchPill();
    renderViewInto(pane!, cur());
  });

  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("[data-popbody], [data-pop]")) closePops();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closePops();
    if (cur()?.searchOpen) {
      cur().searchOpen = false;
      curPane?.querySelector(".lib-searchbar")?.classList.remove("is-open");
    }
  });

  // ── start ──
  const f0 = frameFor(opts.rootContext(), true);
  stack.push(f0);
  setHeader(true, "");
  curPane = buildPane(f0);
  curPane.dataset.pos = "center";
  viewport.appendChild(curPane);

  return {
    // Refresh data without losing the user's place. Live grouping closures pick up
    // new data; we just re-render the visible pane (deeper frames re-render on back).
    reload() {
      if (stack.length === 1) {
        stack[0].ctx = opts.rootContext();
        if (!groupingOf(stack[0])) stack[0].grouping = stack[0].ctx.groupings[0].key;
      }
      if (!curPane) return;
      // a background sync shouldn't yank the user to the top
      const v = curPane.querySelector<HTMLElement>("[data-view]");
      const keep = v ? v.scrollTop : 0;
      renderViewInto(curPane, cur());
      const v2 = curPane.querySelector<HTMLElement>("[data-view]");
      if (v2) v2.scrollTop = keep;
    },
  };
}
