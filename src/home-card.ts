// Home card (HOME.md) — the landing card: three shelves of what you played, what you
// added, and what this kind of hour usually holds. Nearly every tile is local. The card
// makes two Apple calls, one per shelf, at most once per floor (HOME.md §9): the plays
// and the adds made on your other devices, which never reach this machine otherwise.
// The refresh square asks Apple again; a failed call costs only the continuity.
//
// The shelves are the artist view's shelves (ARTIST-VIEW.md §2.2): a label, then one row
// of tiles that scrolls sideways, stacked down the card — the same `.search__scroller` +
// `.search__tile` markup, so Home wears no layout CSS of its own and all three shelves
// stay on screen at any window size (his call, 2026-09-15; it replaced a one-row-of-the-
// grid cap on the collection-card engine, which the card's width kept squeezing).
//
// This card does NOT ride the collection-card engine: with no vertical row list under
// the shelves, its Sort / View / Search toolbar would act on nothing. What is left is
// small — build the markup, delegate three listeners.
//
// The shelves rebuild when the library, the playlists or the played song changes, and on
// the header's refresh square — all from SQLite and the caches already in memory.

import { wireListKeys } from "./list-keys";
import { homeShelves, hideItem, fillArtistPhotos, refreshApple, type HomeItem, type HomeShelf } from "./home";
import { playTracks, playStation, onPlayerState } from "./player";
import { stationMenu, tileMenu } from "./media-menu";
import { onPlaylistsChange } from "./playlists";
import { onTracksChange } from "./track-store";
import { toast } from "./toast";
import { openContextMenu, type MenuItem } from "./context-menu";
import { rowDrag, type DragPayload } from "./row-drag";
import { mosaicHTML } from "./mosaic";
import { esc } from "./collection-card";
import { enterRows } from "./pop";
import type { Artwork } from "./library";
import type { CardDef, MountOpts } from "./cards";
import { scrollSnapshot, applyScrollSnapshot } from "./card-memory";
import { isPinned, pinActivate, pinBadgeHTML, handleUnpin, onPinsChange, PIN_GRIP, pinDragRow, isPinGrip } from "./pins";
import { sortByOrder, moveTo, onRowOrderChange, sectionsMovable, holdMs } from "./row-order";
import { pickByKey, pickMenu, suggestMarkItem, onSotdChange, SUGGEST_KEY } from "./sotd";
import * as diag from "./diag";

const err = (what: string) => (e: unknown) => console.error(`[home] ${what}`, e);

const HEAD = `
  <header class="panel__head">
    <h2 class="panel__title">Home</h2>
    <button class="panel__action" id="home-refresh" type="button" aria-label="Refresh Home" title="Builds the shelves again, and asks Apple Music what you played and added elsewhere">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </button>
  </header>
  <div class="panel__body"><div class="lib-shelves" data-shelves></div></div>`;

// ── one tile ──────────────────────────────────────────────────────────────────
const artURL = (art: Artwork | undefined, px: number): string | null =>
  art?.urlTemplate ? art.urlTemplate.replace("{w}", String(px)).replace("{h}", String(px)).replace("{f}", "jpg") : null;

function tileArt(it: HomeItem): string {
  const round = it.round ? " search__tile-art--round" : "";
  const url = artURL(it.art, 192);
  if (url) return `<img class="search__tile-art${round}" src="${esc(url)}" alt="" loading="lazy" decoding="async" />`;
  // A playlist with no artwork of its own (never a round tile, so the base class stands).
  if (it.mosaic?.length) return mosaicHTML("search__tile-art", it.mosaic, it.mosaicSeed ?? it.key);
  return `<div class="search__tile-art search__tile-art--empty${round}" aria-hidden="true">♪</div>`;
}

/** `data-key` is the item's identity — the one thing a listener needs to find it again.
 *  On the Pinned shelf a tile also carries its place in that shelf and the grip that moves
 *  it (MOVABLE-ROWS.md §5.2); everywhere else it is exactly the tile it always was. */
const tileHTML = (it: HomeItem, i: number, pinShelf: boolean): string =>
  `<div class="search__tile${it.dashed ? " search__tile--offer" : ""}" data-key="${esc(it.key)}"` +
  `${pinShelf ? ` data-pin-idx="${i}"` : ""} role="button" tabindex="0" title="${esc(it.title)}">` +
  `${tileArt(it)}${isPinned(it.key) ? pinBadgeHTML(it.key) : ""}${pinShelf ? PIN_GRIP : ""}` +
  `<span class="search__tile-name">${esc(it.title)}</span>` +
  `<span class="search__tile-sub">${esc(it.sub)}</span></div>`;

// A shelf is one block: its label and the tiles under it move together (§4.1). The label
// is the header you hold.
const shelfHTML = (sh: HomeShelf, i: number): string =>
  `<section class="home-shelf" data-idx="${i}" data-shelf="${sh.id}">` +
  `<div class="search__label">${esc(sh.label)}</div>` +
  `<div class="search__scroller">${sh.items.map((it, n) => tileHTML(it, n, sh.id === "pinned")).join("")}</div></section>`;

export const homeCard: CardDef = {
  id: "home",
  title: "Home",
  mount(host, mountOpts?: MountOpts) {
    host.innerHTML = HEAD;
    const refreshBtn = host.querySelector<HTMLElement>("#home-refresh");
    const body = host.querySelector<HTMLElement>(".panel__body")!;
    const shelfBox = host.querySelector<HTMLElement>("[data-shelves]")!;

    let shelves: HomeShelf[] = [];
    let loading = true;
    let alive = true;

    const itemOf = (key: string | undefined): HomeItem | undefined =>
      key ? shelves.flatMap((s) => s.items).find((i) => i.key === key) : undefined;

    // A rebuild keeps each shelf's sideways scroll where the user left it.
    /** The shelves this render draws, in the user's own order (MOVABLE-ROWS.md §2). The
     *  push order in `homeShelves()` is the built-in order; a shelf the rank list does not
     *  name falls to the end (fork 3A). Keyed on `id`, never on the label — the bucket
     *  shelf's label changes with the hour. */
    const ordered = (): HomeShelf[] => sortByOrder("home.shelves", shelves, (sh) => sh.id);
    let shownIds: string[] = [];

    const render = () => {
      const scrolled = [...shelfBox.querySelectorAll<HTMLElement>(".search__scroller")].map((el) => el.scrollLeft);
      const list = ordered();
      shownIds = list.map((sh) => sh.id);
      shelfBox.innerHTML = shelves.length
        ? list.map(shelfHTML).join("")
        : `<p class="lib-empty__msg">${loading ? "Looking through what you play…" : "Play something. Home fills itself."}</p>`;
      shelfBox.querySelectorAll<HTMLElement>(".search__scroller").forEach((el, i) => {
        if (scrolled[i]) el.scrollLeft = scrolled[i];
      });
    };

    // Rebuild every shelf. Cheap and local: one log read, one add-stamp read, the
    // cached playlists. Serialized — a burst of changes coalesces into one pass.
    let pending = false;
    let again = false;
    let first = true;
    const build = () => {
      if (pending) {
        again = true; // a hide (or a play) landed mid-build — run once more after it
        return;
      }
      pending = true;
      refreshBtn?.classList.add("is-busy");
      homeShelves()
        .then((s) => {
          if (alive) shelves = s;
        })
        .catch(err("build"))
        .finally(() => {
          pending = false;
          loading = false;
          refreshBtn?.classList.remove("is-busy");
          if (!alive) return;
          render();
          // The first fill slides its shelves in, as a card's rows do elsewhere.
          if (first && shelves.length) {
            first = false;
            enterRows([...shelfBox.children] as HTMLElement[]);
          }
          // An artist tile with no cached photo: one call each, once ever. Draw again
          // when one lands, so the borrowed album cover swaps for the real face.
          // A rebuild, not a redraw: the tile's artwork was chosen when the item was
          // built, so the new photo only reaches the shelf through another build. The
          // second pass asks for nothing (every name is memoized), so this cannot loop.
          void fillArtistPhotos(shelves.flatMap((sh) => sh.items))
            .then((got) => {
              if (got && alive) build();
            })
            .catch(err("artist photos"));
          if (again) {
            again = false;
            build();
          }
        });
    };

    // ── acting on a tile ──
    const activate = (it: HomeItem) => {
      // A PINNED tile obeys the verb the pin carries, here as in the three cards (PINS.md
      // §8.2 fork 4: one pin, one verb, in all four Pinned shelves). Home has no detail of
      // its own, so an Open hops to the card that holds the item — `pinActivate` with no
      // nav does exactly that.
      if (isPinned(it.key)) {
        pinActivate(it, "home");
        if (it.kind === "station") build();
        return;
      }
      // The click trail (LOGGING.md §The click trail): which tile, and what it stands for
      // — a song tile queues ONE song, an album tile queues the album, and the two lead
      // to very different queues from the same gesture.
      diag.log("ui:act", { at: "home", do: "tile", kind: it.kind, n: it.count ?? 1 });
      if (it.kind === "station" && it.station) {
        void playStation(it.station).then(build).catch(err("play station"));
        return;
      }
      // An album or artist off the library plays whole (its `whole` fetch), not only the songs known.
      void (it.whole?.() ?? Promise.resolve(it.tracks()))
        .then((ts) => (ts.length ? playTracks(ts, 0, it.context) : undefined))
        .catch(err("play"));
    };

    // Hide: the tile goes, the shelf refills from the next candidate, and the toast
    // holds the undo. A hide never changes what the bucket shelf scores (HOME.md §4).
    // A pinned tile is never hidden (PINS.md): its row is Unpin, which the menu carries.
    const hideRow = (it: HomeItem): MenuItem | null => isPinned(it.key) ? null : ({
      label: "Hide",
      run: () => {
        const undo = hideItem(it.key);
        build();
        toast({
          kind: "info",
          text: `Hid ${it.title}`,
          actions: [{ label: "Undo", run: () => { undo(); build(); } }],
        });
      },
    });

    // Every tile's menu is its kind's menu (CONTEXT-MENUS.md), then Hide, the last row.
    const menuFor = (it: HomeItem): MenuItem[] => {
      const away = [hideRow(it)];
      // A station redraws the shelves after it starts (the Recently Played shelf moves).
      if (it.kind === "station" && it.station) {
        const s = it.station;
        return stationMenu(s, { context: it.context, away, play: () => void playStation(s).then(build).catch(err("play station")) });
      }
      // A Song of the Day tile: the pick's own rows (a note, Post Now, Unmark) after the
      // song's, and the suggestion, whose first row is the Mark it exists for (§8.6).
      if (it.key === SUGGEST_KEY) {
        const list = it.tracks();
        const one = Array.isArray(list) ? list[0] : undefined;
        return one ? tileMenu(it, { lead: [suggestMarkItem(one)] }) : [];
      }
      const pick = it.key.startsWith("pick:") ? pickByKey(it.key) : undefined;
      if (pick) return tileMenu(it, { own: pickMenu(pick) });
      return tileMenu(it, { away });
    };

    const payloadFor = (it: HomeItem): DragPayload => ({
      source: "home",
      kind: it.kind === "artist" ? "artist" : it.kind,
      count: it.count,
      tracks: () => it.tracks(),
      station: it.station,
      context: it.context,
      playlistId: it.playlist?.libraryId,
      play: it.kind === "station" && it.station ? () => playStation(it.station as NonNullable<typeof it.station>) : undefined,
    });

    // A tile drags to any card that takes it (DRAG-DROP.md §2). Three presses share the
    // one primitive now (MOVABLE-ROWS.md): a pinned tile's grip moves it along its shelf,
    // a HELD shelf label moves the whole shelf, and anything else is the copy it always was.
    const drag = rowDrag({
      root: body,
      label: "home",
      rowAt: (target) => {
        const pin = pinDragRow(target);
        if (pin) return pin;
        const label = target.closest<HTMLElement>(".search__label");
        if (label && sectionsMovable()) {
          const sec = label.closest<HTMLElement>(".home-shelf");
          const idx = sec?.dataset.idx;
          const id = sec?.dataset.shelf;
          if (sec && idx !== undefined && id) {
            return {
              row: sec,
              index: Number(idx),
              list: shelfBox,
              count: shownIds.length,
              measure: true, // a shelf is as tall as its tiles
              hold: holdMs(),
              done: (to) => {
                if (to != null) void moveTo("home.shelves", shownIds, id, to);
              },
            };
          }
        }
        const el = tileAt(target);
        const it = itemOf(el?.dataset.key);
        return el && it ? { row: el, index: 0, payload: payloadFor(it) } : null;
      },
    });

    // ── three listeners over the whole card ──
    const tileAt = (target: EventTarget | null): HTMLElement | null =>
      target instanceof HTMLElement ? target.closest<HTMLElement>(".search__tile") : null;

    const onClick = (e: MouseEvent) => {
      if (handleUnpin(e)) return; // the badge unpins; the tile does not play
      if (isPinGrip(e)) return; // the grip moves the tile; it never plays it
      if (drag.consumeClick()) return; // the tail of a drag, not a play
      const it = itemOf(tileAt(e.target)?.dataset.key);
      if (it) activate(it);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target instanceof HTMLElement && e.target.closest("[data-unpin]")) return; // the badge's own key press
      const it = itemOf(tileAt(e.target)?.dataset.key);
      if (!it) return;
      e.preventDefault();
      activate(it);
    };
    const onMenu = (e: MouseEvent) => {
      const el = tileAt(e.target);
      const it = itemOf(el?.dataset.key);
      if (!el || !it) return;
      e.preventDefault();
      el.classList.add("is-context");
      openContextMenu(e.clientX, e.clientY, menuFor(it), () => el.classList.remove("is-context"));
    };
    body.addEventListener("click", onClick);
    body.addEventListener("keydown", onKey);
    const unwireKeys = wireListKeys(body, { rows: ".search__tile", activate: false }); // the tiles keep their own Enter
    body.addEventListener("contextmenu", onMenu);

    // ── keeping up to date ──
    // A new song means a new play row, so Recently Played changed. Debounced, and only
    // on a real song change (play/pause fires the same listener).
    let lastSong = "";
    let timer: number | undefined;
    const offState = onPlayerState((s) => {
      const id = `${s.title ?? ""}${s.artist ?? ""}`;
      if (id === lastSong) return;
      lastSong = id;
      window.clearTimeout(timer);
      timer = window.setTimeout(build, 1500);
    });
    const offTracks = onTracksChange(() => build(), "home-card");
    const offPlaylists = onPlaylistsChange(() => build());
    const offPins = onPinsChange(() => build());
    const offSotd = onSotdChange(() => build());
    // A move — this card's own, or a Reset — redraws the shelves. The shelves themselves
    // are unchanged, so this is a render, not a build.
    const offOrder = onRowOrderChange(() => { if (alive) render(); });

    render();
    build();
    refreshBtn?.addEventListener("click", () => {
      refreshApple(); // the square is the one place that overrides the Apple floor
      build();
    });
    // Card memory (CARD-MEMORY.md §5): the body scroll and each shelf's sideways place, once
    // the shelves are built (the build is a local read, so it lands in a later task).
    applyScrollSnapshot(body, mountOpts?.memory, ".search__scroller");

    return {
      snapshot: () => scrollSnapshot(body, ".search__scroller"),
      destroy() {
        alive = false;
        window.clearTimeout(timer);
        offState();
        offSotd();
        offTracks();
        offPlaylists();
        offPins();
        offOrder();
        drag.destroy();
        body.removeEventListener("click", onClick);
        body.removeEventListener("keydown", onKey);
        unwireKeys();
        body.removeEventListener("contextmenu", onMenu);
        host.innerHTML = "";
      },
    };
  },
};
