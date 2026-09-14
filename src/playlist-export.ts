// Export to Apple Music (PLAYLISTS.md §6) — the one-way bridge from a LOCAL playlist.
// Apple's public API can create a library playlist and add songs to it; nothing else.
//
//  - No live Apple copy: Export ▸ Apple Music makes one. The first time, a one-time
//    notice names what DeetsMusic can't do afterwards (the Add to Library pattern).
//  - A live copy (still in the mirror list — no Apple call to check): Export ▸ offers
//    Add New Songs to Apple Copy and Make a New Apple Copy.
//  - Add New Songs compares with the Apple copy first (one read per 100 songs). Only
//    additions → it sends them. Removals or a new order Apple can't copy → a sticky
//    question BEFORE any write, naming what won't carry over.
//
// Gated by Settings › Apple Music › Export playlists (`playlistExport`, default on).

import type { Playlist } from "./search";
import type { MenuItem } from "./context-menu";
import { setting } from "./settings-store";
import { toast, noticeOff } from "./toast";
import { requestSetting } from "./layout-bus";
import { playlistExportPlan, playlistExportApple, type ExportPlan, type ExportResult } from "./playlists";

const NOTICE_KEY = "deets.notice.exportOneWay";

/** “A”, “A” and “B”, “A”, “B” and 3 more. */
function names(titles: string[]): string {
  const q = titles.slice(0, 2).map((t) => `“${t}”`);
  const more = titles.length - q.length;
  if (more > 0) return `${q.join(", ")} and ${more} more`;
  return q.join(" and ");
}

const songs = (n: number) => `${n} song${n === 1 ? "" : "s"}`;
const skippedLine = (n: number) => (n ? ` ${songs(n)} skipped: not in the Apple Music catalog.` : "");

/** Make a fresh Apple copy. `again`: an older copy exists and stays on Apple. */
async function makeNew(p: Playlist, again: boolean, after: () => void): Promise<void> {
  let r: ExportResult;
  try {
    r = await playlistExportApple(p, "new");
  } catch (e) {
    console.error("[export] new", e);
    toast({ kind: "warn", text: `Couldn't export “${p.name}” to Apple Music.` });
    return;
  }
  after();
  if (r.failed) {
    toast({ kind: "warn", text: `Made “${p.name}” on Apple Music, but couldn't add ${songs(r.failed)}.${skippedLine(r.skipped)}` });
    return;
  }
  if (!noticeOff(NOTICE_KEY)) {
    toast({
      kind: "info",
      text: `Made “${p.name}” on Apple Music. DeetsMusic can't rename, reorder, or delete it there; use the Music app. Turn this off in Settings › Apple Music.${skippedLine(r.skipped)}`,
      onceKey: NOTICE_KEY,
      actions: [{ label: "Settings", run: () => requestSetting("playlistexport") }],
    });
    return;
  }
  const text = again ? `Made a new “${p.name}” on Apple Music. The old copy is still there.` : `Made “${p.name}” on Apple Music.`;
  toast({ kind: r.skipped ? "warn" : "success", text: text + skippedLine(r.skipped) });
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
  if (r.failed) {
    toast({ kind: "warn", text: `Added ${songs(r.added)} to “${p.name}” on Apple Music, but couldn't add ${songs(r.failed)}.${skippedLine(plan.skipped)}` });
    return;
  }
  toast({ kind: plan.skipped ? "warn" : "success", text: `Added ${songs(r.added)} to “${p.name}” on Apple Music.${skippedLine(plan.skipped)}` });
}

/** Add New Songs: compare first, confirm what Apple can't copy, then write. */
async function addNew(p: Playlist, after: () => void): Promise<void> {
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

  if (!cant.length) {
    if (n) return sendAdds(p, plan, after);
    toast({ kind: plan.skipped ? "warn" : "success", text: `The Apple copy of “${p.name}” is up to date.${skippedLine(plan.skipped)}` });
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

/**
 * The Export ▸ menu entry for a LOCAL playlist, or null (a mirror, or the setting is off).
 * `mirror` is the card's current unified list: a live Apple copy is one still in it (6A).
 * `after` runs once Apple was written — the card re-syncs the mirror so the copy shows.
 */
export function exportItem(p: Playlist, mirror: () => Playlist[], after: () => void): MenuItem | null {
  if (p.source !== "local" || !setting("playlistExport")) return null;
  return {
    label: "Export",
    sub: () => {
      const live = !!p.exportedAppleId && mirror().some((m) => m.source === "apple" && m.libraryId === p.exportedAppleId);
      if (!live) return [{ label: "Apple Music", run: () => void makeNew(p, !!p.exportedAppleId, after) }];
      return [
        { label: "Add New Songs to Apple Copy", run: () => void addNew(p, after) },
        { label: "Make a New Apple Copy", run: () => void makeNew(p, true, after) },
      ];
    },
  };
}
