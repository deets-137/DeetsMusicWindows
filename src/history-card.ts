// History card — renders the session play log (queue.getPlayLog, docs/QUEUE.md):
// the most recently heard song as a hero block (mirrors the Qcard's Now Playing),
// then the older plays under a "Previously" label, newest first. Repeats are real —
// a song heard three times shows three rows (the log is append-only, unlike the
// deduped Previous back-chain). Rows are read-only; right-click offers Play Now /
// Play Next / Add to Queue via the handle-level player ops (Next/Later are gapless).

import "./styles/qcard.css";
import * as queue from "./queue";
import { playContext, enqueueNext, enqueueLater } from "./player";
import { onTracksChange } from "./track-store";
import { esc } from "./collection-card";
import { resolveEntry, artURL, rowHTML } from "./queue-rows";
import { openContextMenu, type MenuItem } from "./context-menu";
import { addSongToLibraryItem } from "./library-add";
import { startStationItem } from "./start-station";
import { goToArtistItem, goToAlbumItem } from "./go-to";
import type { CardDef, CardInstance } from "./cards";

const LIST_CAP = 50; // render a bounded slice of the older plays

export const historyCard: CardDef = {
  id: "history",
  title: "History",
  mount: (host) => mountHistory(host),
};

function mountHistory(host: HTMLElement): CardInstance {
  host.innerHTML = `<header class="panel__head"><h2 class="panel__title">History</h2></header><div class="panel__body qcard"></div>`;
  const body = host.querySelector<HTMLElement>(".panel__body")!;

  // The view rendered last: newest first, hero at index 0. The contextmenu handler
  // resolves data-idx against this snapshot — render() reassigns it, and both run off
  // the same queue-change emits, so the indices always match the DOM.
  let view: readonly queue.QueueEntry[] = [];

  const render = () => {
    view = [...queue.getPlayLog()].reverse();
    const latest = view[0];

    const t = latest ? resolveEntry(latest) : undefined;
    const cover = artURL(t, 96);
    const heroArt = cover
      ? `<img class="qnow__art" src="${esc(cover)}" alt="" data-art />`
      : `<div class="qnow__art qnow__art--empty" aria-hidden="true">♪</div>`;
    const hero = `
      <div class="qnow${latest ? "" : " qnow--idle"}" data-idx="0">
        ${heroArt}
        <div class="qnow__text">
          <span class="qnow__title">${esc(t?.title ?? (latest ? "Unknown" : ""))}</span>
          <span class="qnow__artist">${esc(t?.artistName ?? "")}</span>
        </div>
      </div>`;

    const older = view.slice(1);
    const rows = older
      .slice(0, LIST_CAP)
      .map((e, i) => {
        const rt = resolveEntry(e);
        return rowHTML(i + 1, rt?.title ?? "Unknown", rt?.artistName ?? "", artURL(rt, 72), false);
      })
      .join("");
    const more =
      older.length > LIST_CAP ? `<li class="qcard__more">+${older.length - LIST_CAP} more</li>` : "";
    const list = rows ? `<ol class="qcard__list">${rows}${more}</ol>` : "";

    // Label + list only once there's something OLDER than the hero — a lone play is
    // just the hero; an empty log is the blank idle hero.
    body.innerHTML = older.length
      ? `${hero}<div class="qcard__label">Previously</div>${list}`
      : hero;
  };

  // Right-click (hero or row) → re-queue this play. The entry is a log copy, so we
  // hand the player a fresh handle stamped with a history context; Play Now starts a
  // 1-song context (manual picks kept), Next/Later insert gapless.
  const menuFor = (e: queue.QueueEntry): MenuItem[] => {
    const h = { catalogId: e.catalogId, libraryId: e.libraryId, context: "history" };
    const err = (what: string) => (x: unknown) => console.error(`[history] ${what}`, x);
    const t = resolveEntry(e); // supplies fallback pane titles for the drill-ins
    const items: MenuItem[] = [
      { label: "Play Now", run: () => void playContext([h], 0).catch(err("play now")) },
      { label: "Play Next", run: () => void enqueueNext([h]).catch(err("play next")) },
      { label: "Add to Queue", run: () => void enqueueLater([h]).catch(err("add to queue")) },
    ];
    // Go to Artist/Album + Start Station + Add to Library — gated builders (null when
    // they shouldn't offer). Apply to the hero too: it shares this handler via data-idx="0".
    const goA = goToArtistItem("songs", e.catalogId, t?.artistName);
    if (goA) items.push(goA);
    const goAl = goToAlbumItem(e.catalogId, t?.albumName);
    if (goAl) items.push(goAl);
    const start = startStationItem("songs", e.catalogId);
    if (start) items.push(start);
    const add = t ? addSongToLibraryItem(t) : null;
    if (add) items.push(add);
    return items;
  };
  body.addEventListener("contextmenu", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]");
    if (!el) return;
    const entry = view[Number(el.dataset.idx)];
    if (!entry) return; // idle hero (nothing played yet)
    e.preventDefault();
    el.classList.add("is-context");
    openContextMenu(e.clientX, e.clientY, menuFor(entry), () => el.classList.remove("is-context"));
  });

  // Re-render on plays (queue change) and when the track store (re)loads so entries
  // resolve instead of showing "Unknown".
  const unsubTracks = onTracksChange(render);
  const unsubQueue = queue.onQueueChange(render);
  render();

  return {
    destroy() {
      unsubTracks();
      unsubQueue();
      host.innerHTML = "";
    },
  };
}
