// Apple Music ▸ (PLAYLISTS.md §6, §10.2, §10.4) — the bridge between a LOCAL playlist and
// its copy on Apple Music. Apple's public API can create a library playlist and add songs
// to it; nothing else.
//
//  - No live Apple copy: Export to Apple Music makes one. The first time, a one-time
//    notice names what DeetsMusic can't do afterwards (the Add to Library pattern).
//  - A live copy (still in the mirror list — no Apple call to check): Send New Songs ·
//    Get New Songs · Make a New Copy. The rows are worded from local state only.
//  - Send New Songs compares with the Apple copy first (one read per 100 songs). Only
//    additions → it sends them. Removals or a new order Apple can't copy → a sticky
//    question BEFORE any write, naming what won't carry over.
//  - Get New Songs adds the songs only the Apple copy has to the END of the local playlist.
//    Nothing local is lost, so it doesn't ask (fork A).
//
// Gated by Settings › Apple Music › Export playlists (`playlistExport`, default on).

import type { Playlist } from "./search";
import type { MenuItem } from "./context-menu";
import { setting } from "./settings-store";
import { toast, noticeOff } from "./toast";
import { requestSetting } from "./layout-bus";
import {
  playlistExportPlan, playlistExportApple, playlistGetAppleSongs, isReplay, ownCover, names, songs, skippedLine,
  type ExportPlan, type ExportResult, type GetSongsResult,
} from "./playlists";

const NOTICE_KEY = "deets.notice.exportOneWay";

/** Make a fresh Apple copy. `again`: an older copy exists and stays on Apple. */
async function makeNew(p: Playlist, again: boolean, after: () => void): Promise<void> {
  let r: ExportResult;
  try {
    r = await playlistExportApple(p, "new");
  } catch (e) {
    console.error("[export] new", e);
    // The create can succeed and the lookup of the new copy still fail: say what exists.
    const created = String(e).includes("created on Apple Music");
    toast({
      kind: "warn",
      text: created
        ? `Made “${p.name}” on Apple Music, but couldn't add its songs. Try Export again; you can delete the empty copy in the Music app.`
        : `Couldn't export “${p.name}” to Apple Music.`,
    });
    if (created) after();
    return;
  }
  after();
  const skipped = skippedLine(r.skippedTitles);
  if (r.failed) {
    toast({ kind: "warn", text: `Made “${p.name}” on Apple Music, but couldn't add ${songs(r.failed)}.${skipped}` });
    return;
  }
  if (!noticeOff(NOTICE_KEY)) {
    toast({
      kind: "info",
      text:
        `Made “${p.name}” on Apple Music. DeetsMusic can't rename, reorder, or delete it there; use the Music app.` +
        // Only a cover the user set is worth the sentence: it never reaches Apple.
        (ownCover(p) ? " Your cover stays in DeetsMusic; Apple Music makes its own." : "") +
        ` Turn this off in Settings › Apple Music.${skipped}`,
      onceKey: NOTICE_KEY,
      actions: [{ label: "Settings", run: () => requestSetting("playlistexport") }],
    });
    return;
  }
  const text = again ? `Made a new “${p.name}” on Apple Music. The old copy is still there.` : `Made “${p.name}” on Apple Music.`;
  toast({ kind: r.skippedTitles.length ? "warn" : "success", text: text + skipped });
}

/** Send the plan's new songs to the current Apple copy. */
async function sendAdds(p: Playlist, plan: ExportPlan, after: () => void): Promise<void> {
  let r: ExportResult;
  try {
    r = await playlistExportApple(p, "append", plan.addIds);
  } catch (e) {
    console.error("[export] append", e);
    toast({
      kind: "warn",
      sticky: true,
      text: `Couldn't add songs to “${p.name}” on Apple Music. The Apple copy may be gone.`,
      actions: [{ label: "Make a New Copy", run: () => void makeNew(p, true, after) }],
    });
    return;
  }
  after();
  const skipped = skippedLine(plan.skippedTitles);
  if (r.failed) {
    toast({ kind: "warn", text: `Added ${songs(r.added)} to “${p.name}” on Apple Music, but couldn't add ${songs(r.failed)}.${skipped}` });
    return;
  }
  toast({ kind: plan.skippedTitles.length ? "warn" : "success", text: `Added ${songs(r.added)} to “${p.name}” on Apple Music.${skipped}` });
}

/** Send New Songs: compare first, confirm what Apple can't copy, then write. */
async function sendNew(p: Playlist, after: () => void): Promise<void> {
  let plan: ExportPlan;
  try {
    plan = await playlistExportPlan(p);
  } catch (e) {
    console.error("[export] plan", e);
    toast({ kind: "warn", text: `Couldn't read the Apple copy of “${p.name}”.` });
    return;
  }
  const again = { label: "Make a New Copy", run: () => void makeNew(p, true, after) };
  if (!plan.appleId) {
    toast({ kind: "warn", sticky: true, text: `The Apple copy of “${p.name}” is gone.`, actions: [again] });
    return;
  }
  const cant: string[] = [];
  if (plan.removedTitles.length) cant.push(`remove ${names(plan.removedTitles)}`);
  if (plan.reordered) cant.push("change the order");
  const n = plan.addIds.length;
  const skipped = skippedLine(plan.skippedTitles);

  if (!cant.length) {
    if (n) return sendAdds(p, plan, after);
    toast({ kind: plan.skippedTitles.length ? "warn" : "success", text: `The Apple copy of “${p.name}” is up to date.${skipped}` });
    return;
  }
  if (!n) {
    toast({
      kind: "warn",
      sticky: true,
      text: `Apple Music can't copy the changes to “${p.name}”: DeetsMusic can't ${cant.join(" or ")} there.`,
      actions: [again],
    });
    return;
  }
  toast({
    kind: "warn",
    sticky: true,
    text: `Apple Music can't copy every change to “${p.name}”. DeetsMusic can add ${songs(n)} (${names(plan.addTitles)}) at the end, but it can't ${cant.join(" or ")}.`,
    actions: [{ label: `Add ${songs(n)}`, run: () => void sendAdds(p, plan, after) }, again],
  });
}

/** Get New Songs: the Apple copy's extra songs → the end of the local playlist (§10.4). */
async function getNew(p: Playlist, after: () => void): Promise<void> {
  let r: GetSongsResult;
  try {
    r = await playlistGetAppleSongs(p);
  } catch (e) {
    console.error("[export] get", e);
    toast({ kind: "warn", text: `Couldn't read the Apple copy of “${p.name}”.` });
    return;
  }
  if (!r.appleId) {
    toast({
      kind: "warn",
      sticky: true,
      text: `The Apple copy of “${p.name}” is gone.`,
      actions: [{ label: "Make a New Copy", run: () => void makeNew(p, true, after) }],
    });
    return;
  }
  const n = r.addedTitles.length;
  toast({
    kind: "success",
    text: n ? `Added ${songs(n)} from Apple Music to “${p.name}”.` : `“${p.name}” already has every song from its Apple copy.`,
  });
}

/**
 * The Apple Music ▸ menu entry for a LOCAL playlist, or null (a mirror, or the setting is off).
 * `lists` is the card's current unified list: a live Apple copy is one still in it (6A).
 * `after` runs once Apple was written — the card re-syncs the mirror so the copy shows.
 */
export function appleMusicItem(p: Playlist, lists: () => Playlist[], after: () => void): MenuItem | null {
  if (p.source !== "local" || !setting("playlistExport")) return null;
  return {
    label: "Apple Music",
    sub: () => {
      const copy = p.exportedAppleId
        ? lists().find((m) => m.source === "apple" && m.libraryId === p.exportedAppleId)
        : undefined;
      if (!copy) return [{ label: "Export to Apple Music", run: () => void makeNew(p, !!p.exportedAppleId, after) }];
      const items: MenuItem[] = [{ label: "Send New Songs", run: () => void sendNew(p, after) }];
      if (!isReplay(p)) items.push({ label: "Get New Songs", run: () => void getNew(p, after) });
      // Apple can't rename its copy. After a rename here, say that a new copy takes the new name.
      items.push({
        label: copy.name === p.name ? "Make a New Copy" : `Make a New Copy (named “${p.name}”)`,
        run: () => void makeNew(p, true, after),
      });
      return items;
    },
  };
}
