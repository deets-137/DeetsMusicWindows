// The Metal skin's moving parts (docs/features/metal.md; skin.css "METAL"; styles.css "Metal").
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
import { hook, onSkinChange } from "./skin";
import { setting, onSettingsChange } from "./settings-store";
import { getCurrent, getHistory, getUpcoming, onQueueChange } from "./queue";
import { artURL, coverArtPx, resolveEntry } from "./queue-rows";
import { playlistCoverFor, onPlaylistCoverChange } from "./playlist-cover";
import { motionReduced } from "./motion";

const GRAIN = { faint: 0.15, fine: 0.3, medium: 0.5, strong: 0.75 } as const;
const TILE = 480; // px of one texture tile: the draft's Medium grain size (his pick: Grain size stays fixed)

const svg = (s: string) => `data:image/svg+xml,${encodeURIComponent(s)}`; // the SVG's address; `url()` at the use

// Brushed stainless: noise stretched along x into fine hairlines, grey, its contrast set by
// `grain` around mid-grey so the overlay blend leaves the metal's own tone.
// Two layers: long hairlines the width of the tile, and shorter streaks (about an eighth of it)
// of their own brightness laid over them, so the lines end and vary as a brushed sheet does;
// one layer alone read as even scan lines (the design review, 2026-10-20). The short layer is the
// quieter one: at equal weight the two pitches beat into a faint hatch (round 2).
function steel(grain: number, px: number): string {
  const slope = 0.16 + grain * 1.2, b = (0.5 - slope / 2).toFixed(3);
  const f = (c: string) => `<feFunc${c} type="linear" slope="${slope.toFixed(3)}" intercept="${b}"/>`;
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><filter id="f" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(0.6 / px).toFixed(5)} 0.9" numOctaves="2" seed="11" stitchTiles="stitch" result="a"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(8 / px).toFixed(5)} 0.42" numOctaves="2" seed="3" stitchTiles="stitch" result="s"/>` +
    `<feComposite in="a" in2="s" operator="arithmetic" k1="0" k2="0.62" k3="0.42" k4="-0.02"/>` +
    `<feColorMatrix type="saturate" values="0"/><feComponentTransfer>${f("R")}${f("G")}${f("B")}<feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>` +
    `</filter><rect width="${px}" height="${px}" filter="url(#f)"/></svg>`);
}

// Acrylic: short, overlapping dabs with the bristle lines inside them, lit from the top left
// into a relief, its contrast cut to 0.55 around mid-grey (a flat patch lit at 34° is sin 34° ≈
// 0.56) for the overlay blend: the low light draws the stroke edges, not brighter streaks under
// small text (the design review, round 4).
// The relief is strong enough to read as paint next to Steel (at Fine it barely differed), and
// the bristle lines live inside the dabs (the product term), so strokes start and end instead of
// running the tile's width as corduroy (the design review, rounds 1 and 2, 2026-10-20).
function acrylic(grain: number, px: number): string {
  const lift = (1.8 + grain * 3).toFixed(2); // a low light (34°) draws each stroke's edge, so the paint reads at this gentle relief
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><filter id="f" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(3 / px).toFixed(5)} ${(7 / px).toFixed(5)}" numOctaves="3" seed="5" stitchTiles="stitch" result="s"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(1.5 / px).toFixed(5)} 0.3" numOctaves="2" seed="9" stitchTiles="stitch" result="b"/>` +
    `<feComposite in="s" in2="b" operator="arithmetic" k1="0.9" k2="0.42" k3="0.08" k4="0" result="h"/>` +
    `<feDiffuseLighting in="h" surfaceScale="${lift}" diffuseConstant="1" lighting-color="#fff" result="l"><feDistantLight azimuth="235" elevation="34"/></feDiffuseLighting>` +
    `<feComponentTransfer in="l"><feFuncR type="linear" slope="0.55" intercept="0.192"/><feFuncG type="linear" slope="0.55" intercept="0.192"/><feFuncB type="linear" slope="0.55" intercept="0.192"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>` +
    `</filter><rect width="${px}" height="${px}" filter="url(#f)"/></svg>`);
}

// The drum holds pictures, not songs: a side shows the nearest neighbor whose cover differs from
// the one on show, so an album played in order keeps the album before and the album after at
// its sides (the break-it pass, 2026-10-20: both sides sat empty for a whole album, and the
// cover does not turn between two songs with one picture). A look this far is no Apple call:
// the tracks are in memory.
const PEEK_REACH = 60;
const peekArt = (side: "prev" | "next"): string | null => {
  const cur = getCurrent();
  const px = coverArtPx();
  // Show cover = Playlist: the cover is the playlist's own picture for every song, so album
  // covers at its sides would change on every song while it stays (the break-it pass).
  if (cur && playlistCoverFor(cur.context, px)) return null;
  const now = cur ? artURL(resolveEntry(cur), px) : null;
  const list = side === "next" ? getUpcoming() : getHistory();
  for (let i = 0; i < Math.min(PEEK_REACH, list.length); i++) {
    const e = list[side === "next" ? i : list.length - 1 - i];
    const src = artURL(resolveEntry(e), px);
    if (src && src !== now) return src;
  }
  return null;
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
  if (motionReduced() || root.dataset.ambient === "paused" || document.hidden) return 0;
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
const WORDS = "metal-words";
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
      c.inert = true; // its buttons never take focus (Tab during a turn landed in the copy: the break-it pass)
      c.dataset.metalGhost = "";
      return c;
    };
    // Copies are made only under Metal: every other skin cloned the words on every change for nothing.
    const isMetal = () => hook("material") === "metal";
    let ghost: HTMLElement | null = isMetal() ? copy() : null;
    let last = title.textContent;
    let shown: HTMLElement | null = null;
    new MutationObserver(() => {
      if (!isMetal()) { last = title.textContent; ghost = null; return; }
      if (title.textContent === last) { ghost = copy(); return; } // the same song's words filled in
      last = title.textContent;
      const old = ghost;
      ghost = copy();
      if (!old) return; // Metal began mid-song: nothing to fade from
      const art = meta.closest(".np")?.querySelector<HTMLElement>(".np__art");
      const dur = turnMs(art ?? meta);
      const host = meta.offsetParent as HTMLElement | null;
      shown?.remove(); // one ghost at a time
      shown = null;
      if (!dur || !host) return;
      const card = meta.closest(".np");
      const parts = [meta, ...(card?.querySelectorAll<HTMLElement>(".np__times, .np__fav, .np__add") ?? [])];
      const badge = art?.querySelector<HTMLElement>(".np__listen--cover");
      // only this fade's own animations: a row slide (full-player.ts) or a hover on the same parts
      // was cancelled with them and jumped (the break-it pass)
      [...parts, ...(badge ? [badge] : [])].forEach((e) => e.getAnimations().forEach((x) => { if (x.id === WORDS) x.cancel(); }));
      Object.assign(old.style, {
        position: "absolute", left: `${meta.offsetLeft}px`, top: `${meta.offsetTop}px`,
        width: `${meta.offsetWidth}px`, height: `${meta.offsetHeight}px`, margin: "0", pointerEvents: "none",
      });
      host.append(old);
      shown = old;
      const t = { duration: dur, easing: "linear", id: WORDS } as const;
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
// A side shows its picture only once it is decoded: before, a slow or failed picture showed as
// a blank slab in the slot, and a failed one stayed (the break-it pass). A failure is forgotten,
// so a later sync (the next song, the link back) tries again.
const ready = new Map<string, boolean>(); // src → decoded (true) or on its way (false)
function warm(src: string | null): void {
  if (!src || ready.has(src)) return;
  ready.set(src, false);
  if (ready.size > 40) ready.delete(ready.keys().next().value as string);
  const im = new Image();
  im.decoding = "async";
  im.src = src;
  im.decode().then(() => { ready.set(src, true); peekSync(); }, () => ready.delete(src));
}
const isReady = (src: string | null): src is string => !!src && ready.get(src) === true;
/** Put a decoded picture in a side slot, or empty it. True when it shows a picture. */
function paint(peek: HTMLElement, src: string | null): boolean {
  if (isReady(src)) { peek.style.setProperty("--peek-art", `url("${src}")`); delete peek.dataset.empty; return true; }
  peek.style.removeProperty("--peek-art");
  peek.dataset.empty = "";
  return false;
}

// A turn is a change of SONG, not of picture address: opening the full player asks for bigger
// pictures, and that counted as a song change (the break-it pass). The sync runs several times
// for one change, so the turn's start and direction are kept, and a queue edit with no song
// change (shuffle, Play Next, a dragged row) updates the sides at once, with no motion.
// The cover's own turn decides the sides' motion: vinyl.ts publishes it on the box
// (data-turn: fwd · back · none, data-turn-song, data-turn-at) and fires `vinyl:turn`. The
// sides guessed the direction alone before and could disagree with the cover (after a card
// rebuild, or a picture that arrived late), which doubled a slot; and they moved while the
// cover stood still (a song with no picture). A sync that runs before the cover has taken the
// new song waits for its event.
const giving = new Map<HTMLElement, () => void>(); // a giving slot's swap, waiting for its cover to be opaque
let waitTimer = 0;
let endTimer = 0;
let seenSong: string | null = null;
let seenAt = 0; // when the queue first named this song
function peekSync(): void {
  wireTextFade();
  const on = document.documentElement.dataset.metalPeek !== undefined && hook("material") === "metal" && onStage();
  const cur = getCurrent();
  const songNow = cur ? cur.catalogId ?? cur.libraryId ?? null : null;
  if (songNow !== seenSong) { seenSong = songNow; seenAt = performance.now(); }
  document.querySelectorAll<HTMLElement>(".np__art").forEach((box) => {
    const dur = turnMs(box);
    const known = songNow !== null && box.dataset.turnSong === `song:${songNow}`;
    // waits one turn at most: a cover that never takes this id (a station) must not hold the sides
    if (on && dur && songNow !== null && !known && performance.now() - seenAt < dur) {
      // the cover has not taken this song yet; its turn syncs again (a guard in case it never does)
      window.clearTimeout(waitTimer);
      waitTimer = window.setTimeout(peekSync, dur + 50);
      return;
    }
    const kind = known ? box.dataset.turn : "none";
    const turnAt = Number(box.dataset.turnAt ?? 0);
    // a little past the turn's own length: the landed cover is removed when its animation ends,
    // a frame or two after this clock (the receiving slot showed under it: the stress test)
    const turning = dur > 0 && (kind === "fwd" || kind === "back") && performance.now() - turnAt < dur + 150;
    // The slot that receives the old cover is the one the cover turned toward.
    const landing: "prev" | "next" = kind === "back" ? "next" : "prev";
    for (const side of ["prev", "next"] as const) {
      let el = box.querySelector<HTMLElement>(`:scope > .metal-peek[data-side="${side}"]`);
      if (!on) { if (el) giving.delete(el); el?.remove(); continue; }
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
      if (receives) {
        peek.dataset.receiving = "";
        // one more look once the turn is over, so the mark does not outlive it
        window.clearTimeout(endTimer);
        endTimer = window.setTimeout(peekSync, Math.max(0, turnAt + dur + 160 - performance.now()));
      } else delete peek.dataset.receiving;
      if ((peek.dataset.src ?? "") === (src ?? "")) {
        // already right: a change still pending from an earlier press is now wrong, cancel it
        // (it fired later and put another cover here: his report, rapid Back / Next)
        window.clearTimeout(Number(peek.dataset.timer ?? 0));
        giving.delete(peek);
        delete peek.dataset.want;
        peek.getAnimations().forEach((a) => a.cancel()); // an emptying giving slot shows again
        // its picture has decoded since: it shows now, with a short fade. Not a receiving slot: an
        // animation outranks the CSS that hides it while the old cover is still on its way, and
        // a copy of that cover showed in the slot mid-turn (the stress test, 2026-10-20).
        if (peek.dataset.empty !== undefined && paint(peek, src) && !receives) peek.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.min(160, dur || 160), easing: "ease-out" });
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
        giving.delete(peek);
        window.clearTimeout(Number(peek.dataset.timer ?? 0));
        peek.dataset.src = src ?? "";
        delete peek.dataset.want;
        const shows = paint(peek, src);
        peek.getAnimations().forEach((a) => a.cancel());
        if (!still && !receives && shows) {
          // from further out, solid: it starts under the departing cover and past the box's edge,
          // so it needs no fade (its first frames were a translucent slab: the review, round 3)
          const edge = side === "next" ? "60% 0" : "-60% 0";
          peek.animate([{ translate: edge }, { translate: "0 0" }], { duration: dur * 0.5, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" });
        }
      };
      window.clearTimeout(Number(peek.dataset.timer ?? 0));
      giving.delete(peek); // a newer picture for this slot replaces any swap still waiting
      const showing = peek.dataset.empty === undefined && peek.dataset.src !== undefined && peek.dataset.src !== "";
      if (receives && !still && showing) {
        // The cover leaving this slot is pushed off the drum, outward, while the old cover is on
        // its way here; it blinked out at the press before (the stress test's frames, 2026-10-20).
        // The animation outranks the CSS that hides a receiving slot, until it ends; then the slot
        // takes its new picture, still hidden until the old cover lands.
        // It keeps turning around the drum, out, deeper and toward edge-on, and fades only at the
        // end: a fade in place showed it through the arriving cover, and a slide sideways brought
        // it out from behind that cover (the review and the stress test's frames, 2026-10-20).
        const cs = getComputedStyle(box);
        const tok = (n: string, d: number) => { const v = parseFloat(cs.getPropertyValue(n)); return Number.isFinite(v) ? v : d; };
        const P = tok("--zoetrope-perspective", 900), w = peek.offsetWidth, k = side === "next" ? 1 : -1;
        const back = P - P / tok("--zoetrope-scale", 0.86);
        const run = tok("--zoetrope-run", 0.26), turn = tok("--zoetrope-turn", 30);
        const pose = (r: number, z: number, deg: number) => `perspective(${P}px) translateX(${k * r * w}px) translateZ(${z}px) rotateY(${k * deg}deg)`;
        peek.getAnimations().forEach((a) => a.cancel());
        peek.animate(
          [{ transform: pose(run, back, turn), opacity: 1 }, { opacity: 1, offset: 0.6 }, { transform: pose(run + 0.32, back - 140, turn + 45), opacity: 0 }],
          { duration: dur * 0.35, easing: "cubic-bezier(0.4, 0, 0.9, 0.6)", fill: "forwards" },
        );
        peek.dataset.timer = String(window.setTimeout(take, Math.max(0, turnAt + dur * 0.35 - performance.now())));
      } else if (still || receives) take();
      else {
        // GIVING: the arriving cover sits on this same picture and leaves from here. The slot
        // changes the moment that cover is opaque in front of it (--zoetrope-stagger, then
        // --zoetrope-rise of its move), under it, so its new neighbor slides in from the edge
        // behind the departing cover and the slot is never empty (it stood bare for ~170 ms: the
        // design review, round 2).
        const tok = (n: string, d: number) => { const v = parseFloat(getComputedStyle(box).getPropertyValue(n)); return Number.isFinite(v) ? v : d; };
        const stagger = tok("--zoetrope-stagger", 0), rise = tok("--zoetrope-rise", 0.35);
        const coveredAt = turnAt + dur * (stagger + (1 - stagger) * rise);
        // The swap waits for the cover's own word (`vinyl:covered`); the timer, well after, only
        // covers a turn that never says it.
        peek.getAnimations().forEach((a) => a.cancel());
        giving.set(peek, take);
        peek.dataset.timer = String(window.setTimeout(take, Math.max(0, coveredAt + 250 - performance.now())));
      }
    }
  });
}

/** Draw the material on <html> (under Metal only; the base skin tokens are inert elsewhere). */
function paintMaterial(): void {
  const root = document.documentElement;
  const props = ["--metal-texture", "--metal-texture-fine", "--metal-size", "--metal-size-fine"];
  const run = ++painted;
  if (hook("material") !== "metal") { props.forEach((p) => root.style.removeProperty(p)); return; }
  const grain = GRAIN[setting("metalGrain")] ?? GRAIN.fine;
  const draw = setting("metalMaterial") === "acrylic" ? acrylic : steel;
  const fine = Math.round(TILE / 2);
  const coarse = draw(grain, TILE), small = draw(grain * 0.8, fine);
  // The SVG paints at once; the baked bitmaps take its place when ready (bake, below).
  if (!baked.has(`${coarse}|${dpr()}`)) root.style.setProperty("--metal-texture", `url("${coarse}")`);
  if (!baked.has(`${small}|${dpr()}`)) root.style.setProperty("--metal-texture-fine", `url("${small}")`);
  root.style.setProperty("--metal-size", `${TILE}px`);
  root.style.setProperty("--metal-size-fine", `${fine}px`);
  void Promise.all([bake(coarse, TILE), bake(small, fine)]).then(([a, b]) => {
    if (run !== painted) return; // a newer material, grain, skin or screen took over
    if (a) root.style.setProperty("--metal-texture", `url("${a}")`);
    if (b) root.style.setProperty("--metal-texture-fine", `url("${b}")`);
  });
}

// Each texture is baked once into a bitmap at the screen's pixel density (the efficiency pass,
// 2026-10-20): as SVG noise filters, every textured card re-rastered them as content moved,
// and a scroll in Settings dropped ~23 % of its frames at 244 Hz against 0 % with the paint
// off. A bitmap blends like any picture. The SVG is kept as the paint until the bitmap is
// ready, and if the canvas refuses it. Baked bitmaps are kept per texture and density (a
// handful at most: two materials × four grains × two sizes), so going back is instant.
let painted = 0;
const baked = new Map<string, string>(); // `${svg}|${dpr}` → blob: URL
const dpr = () => Math.max(1, Math.round((window.devicePixelRatio || 1) * 100) / 100);
async function bake(src: string, css: number): Promise<string | null> {
  const key = `${src}|${dpr()}`;
  const have = baked.get(key);
  if (have) return have;
  try {
    const px = Math.round(css * dpr());
    const im = new Image(px, px);
    im.src = src;
    await im.decode();
    const cv = document.createElement("canvas");
    cv.width = cv.height = px;
    cv.getContext("2d")!.drawImage(im, 0, 0, px, px);
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, "image/png"));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    baked.set(key, url);
    if (baked.size > 16) { const [k, v] = baked.entries().next().value as [string, string]; baked.delete(k); URL.revokeObjectURL(v); }
    return url;
  } catch {
    return null; // the SVG stays the paint
  }
}

export function initMetal(): void {
  paintMaterial();
  // a move to a screen of another density bakes the textures again at its scale
  const watchDpr = () => matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => { paintMaterial(); watchDpr(); }, { once: true });
  watchDpr();
  peekSync();
  onSkinChange(() => { paintMaterial(); peekSync(); });
  // A run of Material or Grain changes (arrow keys held on the row, the Compass cycling a choice)
  // draws the texture once a frame at most, not once a step (the break-it pass, 2026-10-20).
  let painting = 0;
  onSettingsChange((k) => {
    if (k === "metalMaterial" || k === "metalGrain") {
      cancelAnimationFrame(painting);
      painting = requestAnimationFrame(paintMaterial);
    }
    if (k === "metalPeek" || k === "metalCoverChange") queueMicrotask(peekSync); // after skin-settings.ts sets the attribute
  });
  // The side covers follow the queue, and come back when a surface change rebuilds the card.
  onQueueChange(() => peekSync());
  onPlaylistCoverChange(() => peekSync()); // Show cover: Album ⇄ Playlist hides or shows the sides at once
  document.addEventListener("vinyl:turn", () => peekSync()); // the cover took a new song (vinyl.ts)
  document.addEventListener("vinyl:covered", () => [...giving.values()].forEach((take) => take())); // the arriving cover is opaque over its slot
  const later = () => { peekSync(); window.setTimeout(peekSync, 120); window.setTimeout(peekSync, 600); };
  new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ["data-surface", "data-mini", "data-metal-peek"] });
  // …and any time a cover box appears without its side covers (a card mounted, swapped,
  // grown), at most one look a frame: it ran on every DOM change in the app before.
  let looking = false;
  new MutationObserver(() => {
    if (looking || document.documentElement.dataset.metalPeek === undefined || hook("material") !== "metal" || !onStage()) return;
    looking = true;
    requestAnimationFrame(() => {
      looking = false;
      if ([...document.querySelectorAll(".np__art")].some((b) => !b.querySelector(":scope > .metal-peek"))) peekSync();
    });
  }).observe(document.body, { childList: true, subtree: true });
}
