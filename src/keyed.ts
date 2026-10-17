// The keyed patch (UX-COVERUPS.md §7.7 step 2): a redraw keeps the elements that did not
// change. A card builds its markup as one string, as before; `patchHTML` puts that string into
// a container by changing only what differs:
//
//   - a child whose key is still there and whose markup is the same stays: the same node, its
//     loaded cover, its hover, its running motion;
//   - a child whose markup changed is patched inside when its own tag is the same and both
//     sides hold only elements (a shelf, a row of parts); else it is made new, and every
//     `<img>` of the old one with the same `src` moves into the new one, so the picture never
//     loads again;
//   - a new key is added, a gone key is removed, a key that moved is moved (its node, with its
//     picture).
//
// The key of a child: `data-key` (Home's tiles, the pins), else `data-k` (the engine's rows,
// set by the card), else its tag and first class with its place among the children of that shape.
// `data-idx` is not part of the markup that is compared: a row that only moved down keeps its
// node and takes the new index.
//
// What is compared is the markup the card BUILT (kept per node), never the live DOM: hint.ts
// moves `title` to `data-hint`, the motion adds classes, and those must not read as changes.

const built = new WeakMap<Element, string>();

/** The markup of `el` as built, with `data-idx` taken out (a row that only moved is the same row). */
const bare = (html: string): string => html.replace(/ data-idx="[^"]*"/g, "");

function keyOf(el: Element, seen: Map<string, number>): string {
  const k = el.getAttribute("data-key") ?? el.getAttribute("data-k");
  if (k !== null) {
    // The same key twice (a song twice in a playlist): each one is its own child.
    const n = seen.get(`k:${k}`) ?? 0;
    seen.set(`k:${k}`, n + 1);
    return n ? `k:${k}#${n}` : `k:${k}`;
  }
  // The first class only: a state class (`is-less`, `qnow--idle`) is not another child.
  const sig = `s:${el.tagName}.${(el.getAttribute("class") ?? "").trim().split(/\s+/)[0]}`;
  const n = seen.get(sig) ?? 0;
  seen.set(sig, n + 1);
  return `${sig}#${n}`;
}

/** Record the built markup of `el` and of every element in it. */
function remember(el: Element): void {
  built.set(el, el.outerHTML);
  for (const d of el.querySelectorAll("*")) built.set(d, d.outerHTML);
}

/** Only element children (no text that counts): the children can be patched one by one. */
const onlyElements = (el: Element): boolean => {
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) return false;
  return true;
};

/** The opening tag of an element's markup, `data-idx` out. */
const openTag = (html: string): string => bare(html.slice(0, html.indexOf(">") + 1));

/** Copy the attributes of `from` onto `to` (an element kept for its children). */
function syncAttrs(to: Element, from: Element): void {
  for (const a of [...to.attributes]) {
    // A hint the live node carries came from a `title` the new markup still has (or not).
    if (a.name === "data-hint") {
      if (!from.hasAttribute("title")) to.removeAttribute("data-hint");
      continue;
    }
    if (!from.hasAttribute(a.name)) to.removeAttribute(a.name);
  }
  for (const a of from.attributes) if (to.getAttribute(a.name) !== a.value) to.setAttribute(a.name, a.value);
}

type Pool = Map<string, HTMLImageElement[]>;
/** Add each loaded `<img>` of `el` to `pool`, by its source. */
function harvest(el: Element, pool: Pool): void {
  el.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("data-art-src") ?? img.getAttribute("src") ?? "";
    if (!src || !img.complete || !img.naturalWidth) return;
    const list = pool.get(src) ?? [];
    list.push(img);
    pool.set(src, list);
  });
}

/** Move into `fresh` each `<img>` of `old` with the same `src`: the loaded picture stays. */
function carryImages(old: Element, fresh: Element): void {
  const pool: Pool = new Map();
  harvest(old, pool);
  swapIn(fresh, pool);
}

/** Put into `fresh` a loaded picture from `pool` for each `<img>` whose source it holds. */
function swapIn(fresh: Element, pool: Pool): void {
  if (!pool.size) return;
  fresh.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    const kept = pool.get(src)?.shift();
    if (!kept) return;
    // The new markup's attributes win (a class, an alt); the node and its pixels stay.
    for (const a of img.attributes) if (a.name !== "src" && kept.getAttribute(a.name) !== a.value) kept.setAttribute(a.name, a.value);
    img.replaceWith(kept);
  });
}

/** Patch `old` (live) toward `fresh` (just parsed): returns the node that stays in its place. */
function patchOne(old: Element, fresh: Element): Element {
  const was = built.get(old);
  const now = fresh.outerHTML;
  if (was !== undefined && bare(was) === bare(now)) {
    const idx = fresh.getAttribute("data-idx");
    if (idx !== null && old.getAttribute("data-idx") !== idx) old.setAttribute("data-idx", idx);
    built.set(old, now);
    return old;
  }
  // A picture with the same source is the same picture, whatever else its tag says.
  if (old instanceof HTMLImageElement && fresh instanceof HTMLImageElement) {
    const src = fresh.getAttribute("src");
    if (src && (old.getAttribute("src") === src || old.getAttribute("data-art-src") === src)) {
      for (const a of fresh.attributes) if (a.name !== "src" && old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
      built.set(old, now);
      return old;
    }
  }
  if (
    was !== undefined &&
    old.tagName === fresh.tagName &&
    old.tagName !== "IMG" &&
    onlyElements(fresh) &&
    onlyElements(old) &&
    fresh.childElementCount > 0
  ) {
    if (openTag(was) !== openTag(now)) syncAttrs(old, fresh);
    else {
      const idx = fresh.getAttribute("data-idx");
      if (idx !== null) old.setAttribute("data-idx", idx);
    }
    patchChildren(old, [...fresh.children]);
    built.set(old, now);
    return old;
  }
  carryImages(old, fresh);
  remember(fresh);
  old.replaceWith(fresh);
  return fresh;
}

/** Put `next` (parsed, not in the page) as the element children of `parent` after `after`. */
function patchChildren(parent: Element, next: Element[], after: Node | null = null): void {
  const first = after ? after.nextSibling : parent.firstChild;
  const olds: Element[] = [];
  const stray: ChildNode[] = [];
  for (let n = first; n; n = n.nextSibling) {
    if (n instanceof Element) olds.push(n);
    else stray.push(n); // whitespace between children
  }
  stray.forEach((n) => n.remove());
  const seenOld = new Map<string, number>();
  const byKey = new Map<string, Element>();
  for (const el of olds) byKey.set(keyOf(el, seenOld), el);
  const seenNew = new Map<string, number>();
  const placed: Element[] = [];
  for (const fresh of next) {
    const k = keyOf(fresh, seenNew);
    const old = byKey.get(k);
    if (old) {
      byKey.delete(k);
      placed.push(patchOne(old, fresh));
    } else {
      remember(fresh);
      placed.push(fresh);
      added?.push(fresh);
    }
  }
  for (const el of byKey.values()) {
    if (gone) harvest(el, gone);
    el.remove();
  }
  // In order, moving only what is out of place.
  let cursor: Node | null = after ? after.nextSibling : parent.firstChild;
  for (const el of placed) {
    if (cursor === el) {
      cursor = el.nextSibling;
      continue;
    }
    parent.insertBefore(el, cursor);
  }
}

const tpl = document.createElement("template");

/**
 * Put `html` into `parent` as a keyed patch. With `after`, only the children after that node
 * are patched (a kept sticky bar stays as it is). The first call on an empty container is a
 * plain insert.
 */
export function patchHTML(parent: Element, html: string, after: Node | null = null): void {
  tpl.innerHTML = html;
  const next = [...tpl.content.children];
  tpl.content.replaceChildren(); // the parsed nodes now belong to no one but `next`
  // A picture whose row left and whose source a new row shows (two songs of one album in two
  // search answers) moves into the new row: the same pixels, never a second load (§7.13: 4–6
  // covers made again per pasted search, 2026-10-17).
  gone = new Map();
  added = [];
  try {
    patchChildren(parent, next, after);
    const pool = gone;
    added.forEach((el) => swapIn(el, pool));
  } finally {
    gone = null;
    added = null;
  }
}
let gone: Pool | null = null;
let added: Element[] | null = null;

/** Give a row's markup its key (`data-k` on its root element), for `patchHTML`. */
export function keyRow(html: string, key: string): string {
  const safe = key.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 data-k="${safe}"`);
}
