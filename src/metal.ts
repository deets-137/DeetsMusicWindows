// The Metal skin's moving parts (docs/ideas/metal.md; skin.css "METAL"; styles.css "Metal").
// - The material: the card, page and control textures, drawn as SVG noise from Settings ›
//   Skin settings (Material: finely brushed stainless steel or thick acrylic paint; Grain) and
//   published on <html> as --metal-texture / --metal-texture-fine. Drawn only under Metal.
// - The peek: in Max and the player view, the previous and next songs' covers wait behind the
//   cover (.metal-peek), and the zoetrope (vinyl.ts, --cover-swap) turns between them. One layer
//   per slot: the slot receiving the old cover shows only as it lands, the slot the new cover
//   left refills during the turn.
// - The words: the song's title, artist and album, its times and heart, leave and arrive with
//   the turn, so the text and the picture change together; the Plays badge fades up as the
//   cover lands.
// skin-settings.ts publishes the attributes (data-metal-material, data-metal-cover,
// data-metal-peek); this file draws and moves. Every motion runs on one clock (turnMs): the
// turn's duration × --motion-scale, and nothing under reduced motion or a hidden window.
// Built from the dev draft and its reviews (metal.md §6.1); DESK-TESTS.md §6.6 is its test.
import { currentSkin, onSkinChange } from "./skin";
import { setting, onSettingsChange } from "./settings-store";
import { getCurrent, getHistory, onQueueChange, peekNext } from "./queue";
import { artURL, coverArtPx, resolveEntry } from "./queue-rows";
import { playlistCoverFor } from "./playlist-cover";

const GRAIN = { faint: 0.15, fine: 0.3, medium: 0.5, strong: 0.75 } as const;
const TILE = 480; // px of one texture tile: the draft's Medium grain size (his pick: Grain size stays fixed)

const svg = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

// Brushed stainless: noise stretched along x into fine hairlines, grey, its contrast set by
// `grain` around mid-grey so the overlay blend leaves the metal's own tone.
function steel(grain: number, px: number): string {
  const slope = 0.12 + grain * 1.0, b = (0.5 - slope / 2).toFixed(3);
  const f = (c: string) => `<feFunc${c} type="linear" slope="${slope.toFixed(3)}" intercept="${b}"/>`;
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><filter id="f" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(0.8 / px).toFixed(5)} 0.95" numOctaves="2" seed="11" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/><feComponentTransfer>${f("R")}${f("G")}${f("B")}<feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>` +
    `</filter><rect width="${px}" height="${px}" filter="url(#f)"/></svg>`);
}

// Acrylic: short, overlapping dabs with the bristle lines inside them, lit from the top left
// into a relief, re-centred on mid-grey for the soft-light blend.
function acrylic(grain: number, px: number): string {
  const lift = (1.2 + grain * 3).toFixed(2);
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><filter id="f" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(3 / px).toFixed(5)} ${(7 / px).toFixed(5)}" numOctaves="3" seed="5" stitchTiles="stitch" result="s"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(1.5 / px).toFixed(5)} 0.3" numOctaves="2" seed="9" stitchTiles="stitch" result="b"/>` +
    `<feComposite in="s" in2="b" operator="arithmetic" k1="0" k2="0.62" k3="0.24" k4="0" result="h"/>` +
    `<feDiffuseLighting in="h" surfaceScale="${lift}" diffuseConstant="1" lighting-color="#fff" result="l"><feDistantLight azimuth="235" elevation="50"/></feDiffuseLighting>` +
    `<feComponentTransfer in="l"><feFuncR type="linear" slope="1" intercept="-0.25"/><feFuncG type="linear" slope="1" intercept="-0.25"/><feFuncB type="linear" slope="1" intercept="-0.25"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>` +
    `</filter><rect width="${px}" height="${px}" filter="url(#f)"/></svg>`);
}

const peekArt = (side: "prev" | "next"): string | null => {
  const cur = getCurrent();
  const px = coverArtPx();
  // Show cover = Playlist: the cover is the playlist's own picture for every song, so album
  // covers at its sides would change on every song while it stays (the break-it pass).
  if (cur && playlistCoverFor(cur.context, px)) return null;
  const h = getHistory();
  const e = side === "next" ? peekNext() : h[h.length - 1] ?? null;
  const src = e ? artURL(resolveEntry(e), px) : null;
  return src && cur && src === artURL(resolveEntry(cur), px) ? null : src;
};

// The stage: the side covers exist only where they show (Max, the player view). In Midi they
// were made and their pictures fetched for nothing (the break-it pass).
const onStage = (): boolean => {
  const r = document.documentElement;
  return r.dataset.surface === "max" || (r.dataset.surface === "mini" && r.dataset.mini === "player");
};

/** The turn's length on screen, one clock for the cover, its sides and its words: the CSS
 *  duration × --motion-scale (as vinyl.ts times the cover), and 0 when nothing should move:
 *  reduced motion, or a held or hidden window (vinyl.ts skips the turn then; the sides and the
 *  words did not, and their throttled timers left a slot empty: the break-it pass). */
function turnMs(el: Element): number {
  const root = document.documentElement;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || root.dataset.ambient === "paused" || document.hidden) return 0;
  const cs = getComputedStyle(el);
  const k = parseFloat(cs.getPropertyValue("--motion-scale"));
  return (parseFloat(cs.getPropertyValue("--vinyl-swap-dur")) || 0) * 1000 * (Number.isFinite(k) ? k : 1);
}

// The song's words change at once. Under Metal the old words stay where they were and
// cross-fade into the new ones as the new cover passes the middle, so the text and the
// picture change together and the title never blinks out (the design review, rounds 1 and 4).
// The old words are a copy of the card's words, refreshed whenever they change without a new
// title (an artist line that filled in a beat later was missing from it: the break-it pass),
// laid over the card's own words while they fade. One copy at a time: rapid skips piled them up.
function wireTextFade(): void {
  document.querySelectorAll<HTMLElement>(".np__meta").forEach((meta) => {
    const title = meta.querySelector<HTMLElement>(".np__title");
    if (!title || title.dataset.metalFade !== undefined) return;
    title.dataset.metalFade = "";
    const copy = () => {
      const c = meta.cloneNode(true) as HTMLElement;
      c.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
      c.removeAttribute("id");
      c.setAttribute("aria-hidden", "true");
      c.dataset.metalGhost = "";
      return c;
    };
    let ghost = copy();
    let last = title.textContent;
    let shown: HTMLElement | null = null;
    new MutationObserver(() => {
      if (title.textContent === last) { ghost = copy(); return; } // the same song's words filled in
      last = title.textContent;
      const old = ghost;
      ghost = copy();
      const root = document.documentElement;
      if (root.dataset.skin !== "metal") return;
      const art = meta.closest(".np")?.querySelector<HTMLElement>(".np__art");
      const dur = turnMs(art ?? meta);
      const host = meta.offsetParent as HTMLElement | null;
      shown?.remove(); // one ghost at a time
      shown = null;
      if (!dur || !host) return;
      const card = meta.closest(".np");
      const parts = [meta, ...(card?.querySelectorAll<HTMLElement>(".np__times, .np__fav, .np__add") ?? [])];
      const badge = art?.querySelector<HTMLElement>(".np__listen--cover");
      [...parts, ...(badge ? [badge] : [])].forEach((e) => e.getAnimations().forEach((x) => x.cancel()));
      Object.assign(old.style, {
        position: "absolute", left: `${meta.offsetLeft}px`, top: `${meta.offsetTop}px`,
        width: `${meta.offsetWidth}px`, height: `${meta.offsetHeight}px`, margin: "0", pointerEvents: "none",
      });
      host.append(old);
      shown = old;
      const t = { duration: dur, easing: "linear" } as const;
      // one after the other, never both at once (round 5 of the review), and in the cover's
      // direction (round 6): the old words leave to the left, the new ones come in from the right
      old.animate([
        { opacity: 1, translate: "0 0", easing: "cubic-bezier(0.4, 0, 1, 1)" },
        { opacity: 0, translate: "-10px 0", offset: 0.28 },
        { opacity: 0, translate: "-10px 0" },
      ], t).finished.then(() => { old.remove(); if (shown === old) shown = null; }, () => old.remove());
      meta.animate([
        { opacity: 0, translate: "10px 0" },
        { opacity: 0, translate: "10px 0", offset: 0.32, easing: "cubic-bezier(0, 0, 0.2, 1)" },
        { opacity: 1, translate: "0 0", offset: 0.62 },
        { opacity: 1, translate: "0 0" },
      ], t);
      // the times and the heart belong to the song too: they arrive with its words (round 6)
      parts.slice(1).forEach((e) => e.animate([{ opacity: 0 }, { opacity: 0, offset: 0.32 }, { opacity: 1, offset: 0.62 }, { opacity: 1 }], t));
      // the new song's Plays badge fades up as its cover lands (rounds 5 and 6)
      badge?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1, offset: 0.85 }, { opacity: 1 }], t);
    }).observe(meta, { characterData: true, childList: true, subtree: true });
  });
}

// A neighbor's picture is fetched and decoded as soon as it is known, at the cover's own size
// (the same address the cover will ask for), so a side cover that comes forward is ready: a
// first Next held the turn while the full-size picture downloaded (his report, 2026-10-20).
const warmed = new Set<string>();
function warm(src: string | null): void {
  if (!src || warmed.has(src)) return;
  warmed.add(src);
  if (warmed.size > 40) warmed.delete(warmed.values().next().value as string);
  const im = new Image();
  im.decoding = "async";
  im.src = src;
  void im.decode().catch(() => undefined); // a failed picture is not fetched again on every sync
}

// A turn is a change of SONG, not of picture address: opening the full player asks for bigger
// pictures, and that counted as a song change (the break-it pass). The sync runs several times
// for one change, so the turn's start and direction are kept, and a queue edit with no song
// change (shuffle, Play Next, a dragged row) updates the sides at once, with no motion.
let shownSong: string | null = null;
let lastPic: string | null = null; // the cover on show before this song
let turnAt = 0;
function peekSync(): void {
  wireTextFade();
  const on = document.documentElement.dataset.metalPeek !== undefined && currentSkin() === "metal" && onStage();
  const cur = getCurrent();
  const songNow = cur ? cur.catalogId ?? cur.libraryId ?? null : null;
  if (songNow !== shownSong) {
    const box = document.querySelector<HTMLElement>(".np__art");
    lastPic = box?.querySelector<HTMLImageElement>(".vinyl:not(.vinyl--out) img")?.src ?? lastPic;
    shownSong = songNow;
    turnAt = performance.now();
  }
  document.querySelectorAll<HTMLElement>(".np__art").forEach((box) => {
    const dur = turnMs(box);
    const turning = dur > 0 && performance.now() - turnAt < dur;
    // Which slot receives the old cover follows the direction of the turn, not a picture match:
    // after a jump in the Queue card the old cover is not the new neighbor, and the slot it
    // landed in was treated as giving, so two layers showed (the break-it pass). Back is the
    // one case where the next slot's new picture is the cover just left; anything else is
    // forward (vinyl.ts turns a jump forward too).
    const back = !!lastPic && peekArt("next") === lastPic;
    const landing: "prev" | "next" = back ? "next" : "prev";
    for (const side of ["prev", "next"] as const) {
      let el = box.querySelector<HTMLElement>(`:scope > .metal-peek[data-side="${side}"]`);
      if (!on) { el?.remove(); continue; }
      if (!el) {
        el = document.createElement("div");
        el.className = "metal-peek";
        el.dataset.side = side;
        el.setAttribute("aria-hidden", "true");
        box.prepend(el); // first: the cover layers come after it and sit above
      }
      const peek = el;
      const src = peekArt(side);
      warm(src);
      const receives = turning && side === landing;
      if (receives) peek.dataset.receiving = "";
      else delete peek.dataset.receiving;
      if ((peek.dataset.src ?? "") === (src ?? "")) {
        // already right: a change still pending from an earlier press is now wrong, cancel it
        // (it fired later and put another cover here: his report, rapid Back / Next)
        window.clearTimeout(Number(peek.dataset.timer ?? 0));
        delete peek.dataset.want;
        peek.getAnimations().forEach((a) => a.cancel()); // an emptying giving slot shows again
        continue;
      }
      // the same picture already on its way: let its timer run (a repeat sync must not restart it)
      if (peek.dataset.want !== undefined && peek.dataset.want === (src ?? "")) continue;
      peek.dataset.want = src ?? "";
      // One layer per slot (his report, 2026-10-20, the red boxes): a side cover never shows
      // the same picture as a cover moving through its slot.
      // - RECEIVING (the slot the old cover lands in): it takes its picture at once but stays
      //   invisible while the old cover is still in the box (CSS); it shows as that cover goes.
      // - GIVING (the slot the new cover left): it empties the moment the turn starts, then its
      //   new neighbor slides in from the slot's own edge during the turn.
      // - No turn (a queue edit, the first fill, nothing moving): it simply takes the picture.
      const still = !turning || peek.dataset.src === undefined;
      const take = () => {
        peek.dataset.src = src ?? "";
        delete peek.dataset.want;
        if (src) { peek.style.setProperty("--peek-art", `url("${src}")`); delete peek.dataset.empty; }
        else { peek.style.removeProperty("--peek-art"); peek.dataset.empty = ""; }
        peek.getAnimations().forEach((a) => a.cancel());
        if (!still && !receives && src) {
          const edge = side === "next" ? "40% 0" : "-40% 0";
          peek.animate([{ translate: edge, opacity: 0 }, { translate: "0 0", opacity: 1 }], { duration: dur * 0.6, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" });
        }
      };
      window.clearTimeout(Number(peek.dataset.timer ?? 0));
      if (still || receives) take();
      else {
        peek.getAnimations().forEach((a) => a.cancel());
        peek.animate([{ opacity: getComputedStyle(peek).opacity }, { opacity: 0 }], { duration: 80, fill: "forwards" });
        peek.dataset.timer = String(window.setTimeout(take, Math.max(0, turnAt + dur * 0.45 - performance.now())));
      }
    }
  });
}

/** Draw the material on <html> (under Metal only; the base skin tokens are inert elsewhere). */
function paintMaterial(): void {
  const root = document.documentElement;
  const props = ["--metal-texture", "--metal-texture-fine", "--metal-size", "--metal-size-fine"];
  if (currentSkin() !== "metal") { props.forEach((p) => root.style.removeProperty(p)); return; }
  const grain = GRAIN[setting("metalGrain")] ?? GRAIN.fine;
  const draw = setting("metalMaterial") === "acrylic" ? acrylic : steel;
  const fine = Math.round(TILE / 2);
  root.style.setProperty("--metal-texture", draw(grain, TILE));
  root.style.setProperty("--metal-texture-fine", draw(grain * 0.8, fine));
  root.style.setProperty("--metal-size", `${TILE}px`);
  root.style.setProperty("--metal-size-fine", `${fine}px`);
}

export function initMetal(): void {
  paintMaterial();
  peekSync();
  onSkinChange(() => { paintMaterial(); peekSync(); });
  onSettingsChange((k) => {
    if (k === "metalMaterial" || k === "metalGrain") paintMaterial();
    if (k === "metalPeek" || k === "metalCoverChange") queueMicrotask(peekSync); // after skin-settings.ts sets the attribute
  });
  // The side covers follow the queue, and come back when a surface change rebuilds the card.
  onQueueChange(() => peekSync());
  const later = () => { peekSync(); window.setTimeout(peekSync, 120); window.setTimeout(peekSync, 600); };
  new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ["data-surface", "data-mini", "data-metal-peek"] });
  // …and any time a cover box appears without its side covers (a card mounted, swapped,
  // grown), at most one look a frame: it ran on every DOM change in the app before.
  let looking = false;
  new MutationObserver(() => {
    if (looking || document.documentElement.dataset.metalPeek === undefined || currentSkin() !== "metal" || !onStage()) return;
    looking = true;
    requestAnimationFrame(() => {
      looking = false;
      if ([...document.querySelectorAll(".np__art")].some((b) => !b.querySelector(":scope > .metal-peek"))) peekSync();
    });
  }).observe(document.body, { childList: true, subtree: true });
}
