// Rulez's free facts (docs/features/RULEZ.md §3, route 5): the song's ♥, its Diary score and
// play count, the cover's color (§11), the queue's length, minutes since the app opened, minutes idle, the battery and
// the network. Every one reads what the app or the WebView already holds: no Apple call.
//
// Route 10's rule: a fact has a seam (it tells the engine when it moves) or a `next` time; no
// fact runs its own timer. The song's Diary score and play count are read once per song from
// the local database (one statement each) and cached, and their seam fires when they land.

import { invoke } from "@tauri-apps/api/core";
import { onPlayerState } from "./player";
import { getCurrent, getUpcoming, onQueueChange } from "./queue";
import { trackById } from "./track-store";
import { isLoved, onFavoritesChange } from "./favorites";
import { diaryCachedList, diaryGet, onDiaryChange, songKeyOf } from "./diary";
import { onRulesChange, registerFact, ruleReads } from "./rules";
import { currentCover, lookupPalette } from "./album-color";
import { albumWords } from "./album-slots";
import type { Track } from "./library";
import * as diag from "./diag";

const openedAt = Date.now();
let lastInput = Date.now();

const trackNow = (): Track | undefined => {
  const c = getCurrent();
  return c ? trackById(c.catalogId) ?? trackById(c.libraryId) : undefined;
};
const keyNow = (): string => {
  const c = getCurrent();
  return c?.catalogId ?? c?.libraryId ?? "";
};

/** A seam made from a set of callbacks. */
function seamSet(): { seam: (cb: () => void) => () => void; fire: () => void } {
  const subs = new Set<() => void>();
  return {
    seam: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    fire: () => subs.forEach((cb) => cb()),
  };
}

/** The next whole minute, while some rule reads one of `ids`; else null (no wake-ups). */
const nextMinuteFor = (ids: Parameters<typeof ruleReads>[0]) => () =>
  ruleReads(ids) ? Math.ceil((Date.now() + 1) / 60_000) * 60_000 : null;

export function initRulesFacts(): void {
  // ── the song ──
  registerFact("loved", () => {
    const t = trackNow();
    return t ? isLoved(t) : undefined;
  }, { seam: (cb) => onFavoritesChange(cb) });

  // The Diary score and the play count: read once per song, only while a rule reads them.
  const song = seamSet();
  let songKey = "";
  let score: number | undefined;
  let plays: number | undefined;
  const readSong = async () => {
    const key = keyNow();
    if (key === songKey) return;
    songKey = key;
    score = plays = undefined;
    if (!key || !ruleReads(["diaryScore", "plays"])) return;
    const t = trackNow();
    try {
      const [[, n] = ["", 0]] = await invoke<[string, number][]>("pin_play_counts", { keys: [`song:${key}`] });
      if (songKey !== key) return;
      plays = n;
      const entry = t ? diaryCachedList().find((d) => d.album.title === t.albumName && d.album.artistName === t.artistName) : undefined;
      if (entry && t) {
        const full = await diaryGet(entry.id);
        if (songKey !== key) return;
        score = full.songs.find((s) => s.songKey === songKeyOf(t))?.score;
      }
      song.fire();
    } catch (e) {
      diag.warn("rule:factRead", { e: String(e) });
    }
  };
  onPlayerState(() => void readSong());
  onRulesChange(() => {
    // A rule that reads them was just made: read the song playing now.
    if (score === undefined && plays === undefined && ruleReads(["diaryScore", "plays"])) {
      songKey = "";
      void readSong();
    }
  });
  onDiaryChange(() => {
    songKey = ""; // read it again: a score may have changed
    void readSong();
  });
  registerFact("diaryScore", () => score, { seam: song.seam });
  registerFact("plays", () => plays, { seam: song.seam });

  // The cover's color (RULEZ.md §11): the palette the Now Playing card already asks for
  // (`lookupPalette` shares its cache and its in-flight lookup), so no new Apple call. Read
  // once per cover, only while a rule reads it. It lands a moment after the song starts, so
  // it suits a While rule best; its seam rechecks when it lands.
  const cover = seamSet();
  let coverKey: string | null = null;
  let words: ReturnType<typeof albumWords> = {};
  const readCover = () => {
    const { cover: url, catalogId } = currentCover();
    if (url === coverKey) return;
    coverKey = url;
    words = {};
    if (!url || !ruleReads(["albumColor", "albumLight"])) return cover.fire();
    lookupPalette(url, catalogId)
      .then((p) => {
        if (coverKey !== url) return;
        words = albumWords(p);
        cover.fire();
      })
      .catch((e) => diag.warn("rule:factRead", { fact: "albumColor", e: String(e) }));
  };
  onPlayerState(readCover);
  onRulesChange(() => {
    if (words.color === undefined && ruleReads(["albumColor", "albumLight"])) {
      coverKey = null; // a rule that reads it was just made: read the cover playing now
      readCover();
    }
  });
  registerFact("albumColor", () => words.color, { seam: cover.seam });
  registerFact("albumLight", () => words.light, { seam: cover.seam });

  // ── the queue ──
  registerFact("queueLength", () => getUpcoming().length, { seam: (cb) => onQueueChange(cb) });

  // ── time with the app ──
  registerFact("sinceOpen", () => Math.floor((Date.now() - openedAt) / 60_000), { next: nextMinuteFor(["sinceOpen"]) });
  // Idle: minutes with no press or key. Only the step back to 0 needs the engine at once.
  const idle = seamSet();
  const onInput = () => {
    const was = Date.now() - lastInput >= 60_000;
    lastInput = Date.now();
    if (was) idle.fire();
  };
  document.addEventListener("pointerdown", onInput, true);
  document.addEventListener("keydown", onInput, true);
  registerFact("idle", () => Math.floor((Date.now() - lastInput) / 60_000), { seam: idle.seam, next: nextMinuteFor(["idle"]) });

  // ── the battery and the network (the WebView's own APIs) ──
  const power = seamSet();
  let battery: { level: number; charging: boolean } | null = null;
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, cb: () => void) => void }>;
    connection?: { saveData?: boolean; addEventListener?: (t: string, cb: () => void) => void };
  };
  void nav.getBattery?.().then((b) => {
    const take = () => {
      battery = { level: Math.round(b.level * 100), charging: b.charging };
      power.fire();
    };
    b.addEventListener("levelchange", take);
    b.addEventListener("chargingchange", take);
    take();
  }).catch(() => {});
  registerFact("battery", () => battery?.level, { seam: power.seam });
  registerFact("charging", () => battery?.charging, { seam: power.seam });

  const net = seamSet();
  window.addEventListener("online", net.fire);
  window.addEventListener("offline", net.fire);
  nav.connection?.addEventListener?.("change", net.fire);
  registerFact("online", () => navigator.onLine, { seam: net.seam });
  registerFact("dataSaver", () => nav.connection?.saveData ?? false, { seam: net.seam });
}
