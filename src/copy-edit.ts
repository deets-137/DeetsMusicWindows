// The copy editor — DEV ONLY (docs/features/COPY-EDIT.md). main.ts imports this module
// behind `import.meta.env.DEV`, so the release bundle carries none of it. The server half
// is scripts/copy-edit-plugin.mjs, a Vite plugin that only the dev server runs.
//
// A pencil in the title bar (or Alt+E) turns edit mode on. Each piece of words on screen,
// in every card and open panel, is traced to the one place in src/**/*.ts that writes it:
//   - found once: a solid outline. Click and type. Enter or a click away saves; Esc undoes.
//   - a template with ${…} parts: a dashed outline. It shows "{n} songs"; keep each {…}.
//   - found in several places: a dotted outline, locked. Its hover hint names the places.
// Alt+click anything with a hover hint to edit the hint in a small field under it.
//
// A save writes the .ts file at once and holds Vite's reload (his call 3A): the new words
// are on screen already, and the code takes them at the next reload. The music keeps on.
// While edit mode is on, a click on outlined words never reaches the card under it.
//
// Words a card draws after edit mode starts are picked up by a MutationObserver.
// Not offered: index.html (the title bar menu), words built from data (song names),
// toasts, aria labels, and the title bar itself.

type Target = { file: string; start: number; end: number; expect: string };
/** `copies`: a Settings row's words in its mirror files, saved with it (COPY-EDIT.md §2a). */
type Hit = Target & { display: string; kind: "lit" | "run" | "tpl"; at: string; copies?: Target[] };
type Dup = { dups: string[] };
type Rec = { hit: Hit; shown: string; wrapped: boolean };

const EXCLUDE = ".titlebar, .ce-field, script, style, noscript, svg, input, textarea, select, [aria-hidden=true]";
let on = false;
let saved = 0;
let btn: HTMLButtonElement | null = null;
let observer: MutationObserver | null = null;
let rescanTimer = 0;
const recs = new Map<HTMLElement, Rec>();
const marked = new Set<HTMLElement>();
const undrag: HTMLElement[] = [];
/** an element's own hover hint, kept while edit mode puts its own text there */
const ownHint = new Map<HTMLElement, string | undefined>();

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

const collapse = (t: string) => t.replace(/\s+/g, " ").trim();

export async function initCopyEdit(): Promise<void> {
  try {
    const r = await post<{ ok?: boolean }>("/__copy/ping", {});
    if (!r.ok) return;
  } catch {
    return; // the demo's dev server, or any server without the plugin: no toggle
  }
  const host = document.querySelector<HTMLElement>(".chrome-right");
  if (!host) return;

  const css = document.createElement("style");
  css.textContent = `
.ce-top { position: relative; display: flex; align-items: center; }
.ce-top__btn {
  width: var(--web-top-btn-size); height: var(--web-top-btn-size);
  padding: 0; border: none; background: none; color: var(--subtext); cursor: pointer;
  display: grid; place-items: center; position: relative;
  transition: color var(--dur-fast) var(--ease-ui);
}
.ce-top__btn::before { content: ""; position: absolute; inset: calc(-1 * var(--title-hit-y)) calc(-1 * var(--title-hit-x)); }
.ce-top__btn:hover { color: var(--text); }
.ce-top__btn[aria-pressed=true] { color: var(--title); }
.ce-top__btn:focus-visible { outline: var(--focus-ring-w) solid var(--title); outline-offset: var(--focus-ring-off); }
.ce-top__btn svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: var(--web-icon-stroke); stroke-linecap: round; stroke-linejoin: round; }
[data-ce] { outline: var(--focus-ring-w) solid var(--border); outline-offset: var(--focus-ring-off); }
[data-ce][contenteditable] { cursor: text; min-width: 2ch; user-select: text; -webkit-user-select: text; }
[data-ce=tpl] { outline-style: dashed; outline-color: var(--pause); }
[data-ce=dup] { outline-style: dotted; }
[data-ce]:focus { outline-color: var(--title); }
[data-ce=ok] { outline-color: var(--go); }
[data-ce=fail] { outline-color: var(--stop); }
.ce-field {
  position: fixed; z-index: 2147483000; display: grid; gap: var(--space-1);
  min-width: var(--menu-search-w); max-width: var(--menu-fly-max-w);
  padding: var(--space-2); background: var(--menu-surface); color: var(--text);
  border: var(--focus-ring-w) solid var(--panel-border); border-radius: var(--radius-control);
  font: inherit;
}
.ce-field textarea {
  font: inherit; color: inherit; background: var(--surface); resize: vertical;
  border: var(--focus-ring-w) solid var(--border); border-radius: var(--radius-control); padding: var(--space-1);
}
.ce-field__note { color: var(--subtext); }
.ce-field__note[data-fail] { color: var(--stop); }`;
  document.head.appendChild(css);

  const wrap = document.createElement("div");
  wrap.className = "ce-top";
  btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ce-top__btn";
  btn.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-label", "Edit copy");
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
  btn.addEventListener("click", () => void toggle());
  wrap.appendChild(btn);
  host.prepend(wrap);
  setBtnHint();

  window.addEventListener("keydown", onKey, true);
  for (const t of ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "dragstart"]) {
    window.addEventListener(t, shield, true);
  }
}

function setBtnHint(): void {
  if (!btn) return;
  btn.title = on
    ? `Edit copy is on (dev only). ${saved} saved; the code takes them at the next reload. Alt+click a hover hint to edit it`
    : "Edit copy (dev only): type over the app's words, saved into src/ (Alt+E)";
}

async function toggle(): Promise<void> {
  on = !on;
  btn?.setAttribute("aria-pressed", String(on));
  setBtnHint();
  if (on) {
    await scan();
    observer = new MutationObserver((list) => {
      // Typing, and the editor's own wraps, are not new words.
      if (list.every((m) => ours(m.target))) return;
      clearTimeout(rescanTimer);
      rescanTimer = window.setTimeout(() => void scan(), 300);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  } else {
    observer?.disconnect();
    observer = null;
    clearTimeout(rescanTimer);
    closeField();
    for (const el of [...marked]) unmark(el);
    for (const el of undrag.splice(0)) el.draggable = true;
  }
}

function ours(n: Node): boolean {
  const el = n instanceof Element ? n : n.parentElement;
  if (!el) return false;
  if (el.closest(".ce-field, [data-ce]")) return true;
  return el instanceof HTMLElement && el.dataset.ceWrap !== undefined;
}

/** An element's own words (not its children's): what the last probe found nothing for. */
const missed = new WeakMap<Element, string>();
const ownTexts = (n: Element) =>
  [...n.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE && /\p{L}/u.test(c.textContent ?? ""));
const ownText = (n: Element) => ownTexts(n).map((t) => t.textContent).join("|");

/** The leaves that hold words: an element whose words are all its own. */
function leaves(): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => ((n as Element).matches(EXCLUDE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode() as HTMLElement | null; n; n = walk.nextNode() as HTMLElement | null) {
    if (marked.has(n) || n.isContentEditable || n.dataset.ceWrap !== undefined) continue;
    const texts = ownTexts(n);
    if (!texts.length || missed.get(n) === ownText(n)) continue;
    if (n.childElementCount === 0) {
      out.push(n);
      continue;
    }
    // Words beside an icon: each run goes in its own span, so editing it keeps the icon.
    for (const t of texts) {
      const span = document.createElement("span");
      span.dataset.ceWrap = "";
      t.replaceWith(span);
      span.appendChild(t);
      out.push(span);
    }
  }
  return out.filter((el) => el.getClientRects().length > 0);
}

async function scan(): Promise<void> {
  const els = leaves();
  if (!els.length) return;
  const texts = [...new Set(els.map((el) => collapse(el.textContent ?? "")))];
  let hits: Record<string, Hit | Dup>;
  try {
    hits = (await post<{ hits: Record<string, Hit | Dup> }>("/__copy/probe", { texts })).hits;
  } catch {
    return;
  }
  if (!on) {
    for (const el of els) if (el.dataset.ceWrap !== undefined) unwrap(el);
    return;
  }
  for (const el of els) {
    const shown = collapse(el.textContent ?? "");
    const h = hits[shown];
    if (!h) {
      if (el.dataset.ceWrap !== undefined) {
        const parent = el.parentElement;
        unwrap(el);
        if (parent) missed.set(parent, ownText(parent));
      } else missed.set(el, ownText(el));
      continue;
    }
    marked.add(el);
    if ("dups" in h) {
      el.dataset.ce = "dup";
      keepHint(el, `Written in ${h.dups.length === 6 ? "6 or more" : h.dups.length} places: ${h.dups.join(", ")}`);
      continue;
    }
    recs.set(el, { hit: h, shown: el.textContent ?? "", wrapped: el.dataset.ceWrap !== undefined });
    el.dataset.ce = h.kind === "tpl" ? "tpl" : "on";
    el.setAttribute("contenteditable", "plaintext-only");
    el.spellcheck = false;
    if (h.kind === "tpl") el.textContent = h.display;
    keepHint(el, h.at);
    el.addEventListener("blur", onBlur);
    const drag = el.closest<HTMLElement>('[draggable="true"]');
    if (drag) {
      drag.draggable = false;
      undrag.push(drag);
    }
  }
}

function keepHint(el: HTMLElement, text: string): void {
  if (!ownHint.has(el)) ownHint.set(el, el.dataset.hint);
  el.dataset.hint = text;
}

function unwrap(span: HTMLElement): void {
  const t = span.firstChild;
  if (t) span.replaceWith(t);
  else span.remove();
}

function unmark(el: HTMLElement): void {
  const rec = recs.get(el);
  if (rec && rec.hit.kind === "tpl" && el.dataset.ce !== "ok") el.textContent = rec.shown;
  el.removeAttribute("contenteditable");
  el.removeEventListener("blur", onBlur);
  delete el.dataset.ce;
  if (ownHint.has(el)) {
    const h = ownHint.get(el);
    if (h === undefined) delete el.dataset.hint;
    else el.dataset.hint = h;
    ownHint.delete(el);
  }
  if (el.dataset.ceWrap !== undefined) unwrap(el);
  recs.delete(el);
  marked.delete(el);
}

type Saved = Partial<Target> & { ok?: boolean; error?: string; copies?: Target[] };

async function saveText(hit: Hit, value: string): Promise<Saved> {
  try {
    const { file, start, end, expect, copies } = hit;
    const r = await post<Saved>("/__copy/save", { file, start, end, expect, copies, value });
    if (r.ok && r.expect !== undefined && r.start !== undefined && r.end !== undefined) {
      // The same text can be edited again: it, and each copy, now sits at the new place.
      hit.expect = r.expect;
      hit.start = r.start;
      hit.end = r.end;
      if (hit.copies) hit.copies = r.copies;
      hit.display = value;
      saved++;
      setBtnHint();
    }
    return r;
  } catch (err) {
    return { error: String(err) };
  }
}

async function onBlur(e: FocusEvent): Promise<void> {
  const el = e.currentTarget as HTMLElement;
  const rec = recs.get(el);
  if (!rec) return;
  const value = el.textContent ?? "";
  if (value === rec.hit.display) return;
  const r = await saveText(rec.hit, value);
  if (r.ok) {
    el.dataset.ce = "ok";
    keepHint(el, `Saved to ${rec.hit.at}. The code takes it at the next reload`);
  } else {
    el.dataset.ce = "fail";
    keepHint(el, r.error ?? "Not saved");
  }
}

/** While edit mode is on, a press on outlined words stays with the words. */
function shield(e: Event): void {
  if (!on) return;
  const t = e.target as Element | null;
  if (e.type === "click" && (e as MouseEvent).altKey) {
    const anchor = t?.closest<HTMLElement>("[data-hint]");
    if (anchor && !anchor.closest(".ce-field")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      void openHintField(anchor);
    }
    return;
  }
  const el = t?.closest<HTMLElement>("[data-ce]");
  if (!el) return;
  e.stopImmediatePropagation();
  if (e.type === "contextmenu" || e.type === "dragstart") e.preventDefault();
  // A button's words take no caret from a click in Chromium: place it here.
  if (e.type === "mouseup" && el.isContentEditable && document.activeElement !== el) {
    const me = e as MouseEvent;
    el.focus();
    const range = document.caretRangeFromPoint(me.clientX, me.clientY);
    const sel = getSelection();
    if (range && sel && el.contains(range.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "e") {
    e.preventDefault();
    e.stopImmediatePropagation();
    void toggle();
    return;
  }
  if (!on) return;
  const el = (e.target as Element | null)?.closest<HTMLElement>("[data-ce]");
  if (!el || !el.isContentEditable) return;
  e.stopImmediatePropagation(); // typing never reaches the card's keys or the player's Space
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    el.blur();
  } else if (e.key === "Escape") {
    e.preventDefault();
    const rec = recs.get(el);
    if (rec) el.textContent = rec.hit.display;
    el.blur();
  }
}

// ---- Alt+click: the hover hint field ----

let field: HTMLElement | null = null;

function closeField(): void {
  field?.remove();
  field = null;
}

async function openHintField(anchor: HTMLElement): Promise<void> {
  closeField();
  const text = ownHint.has(anchor) ? ownHint.get(anchor) : anchor.dataset.hint;
  if (!text) return;
  const box = document.createElement("div");
  box.className = "ce-field";
  box.setAttribute("data-tauri-drag-region", "false");
  const area = document.createElement("textarea");
  area.rows = 3;
  area.value = text;
  area.spellcheck = false;
  const note = document.createElement("div");
  note.className = "ce-field__note";
  note.textContent = "Finding it…";
  box.append(area, note);
  document.body.appendChild(box);
  field = box;
  const r = anchor.getBoundingClientRect();
  box.style.left = `${Math.max(0, Math.min(r.left, innerWidth - box.offsetWidth))}px`;
  box.style.top = `${Math.min(r.bottom, innerHeight - box.offsetHeight)}px`;

  let hit: Hit | null = null;
  try {
    const h = (await post<{ hits: Record<string, Hit | Dup> }>("/__copy/probe", { texts: [text] })).hits[collapse(text)];
    if (!h) note.textContent = "Not found in src/ (index.html, or built from data)";
    else if ("dups" in h) note.textContent = `Written in several places: ${h.dups.join(", ")}`;
    else {
      hit = h;
      area.value = h.display;
      note.textContent = `${h.at}. Enter saves, Shift+Enter a new line, Esc closes`;
    }
  } catch {
    note.textContent = "The dev server did not answer";
  }
  if (field !== box) return;
  area.readOnly = !hit;
  area.focus();
  area.addEventListener("keydown", async (e) => {
    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      closeField();
    } else if (e.key === "Enter" && !e.shiftKey && hit) {
      e.preventDefault();
      if (area.value === hit.display) return closeField();
      const res = await saveText(hit, area.value);
      if (res.ok) {
        const shown = hit.kind === "tpl" ? null : area.value;
        if (shown !== null) {
          if (ownHint.has(anchor)) ownHint.set(anchor, shown);
          else anchor.dataset.hint = shown;
        }
        closeField();
      } else {
        note.dataset.fail = "";
        note.textContent = res.error ?? "Not saved";
      }
    }
  });
  area.addEventListener("blur", () => setTimeout(() => field === box && !box.contains(document.activeElement) && closeField(), 0));
}
