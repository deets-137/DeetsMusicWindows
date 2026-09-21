// Song of the Day (docs/integrations/DeetsOTD.md) — the window's half. One song you mark for one day;
// it shows on Home's last shelf and in Rewind, and goes out through the outlets you set up.
//
// The rules live in Rust (sotd/): the journal day, the per-day limit, when a post goes, and
// the secrets. This file is the mirror the cards read without an await, the menu rows, and
// the toasts. It never sees a webhook URL.
//
// Everything here is local. Marking a song costs no Apple call: the pick keeps the song as
// it was (`meta`), so a pick still draws after the song leaves your library.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Track } from "./library";
import type { MenuItem } from "./context-menu";
import { songItem, type HomeItem } from "./home";
import { playEventsSince } from "./rewind";
import { trackById } from "./track-store";
import { setting } from "./settings-store";
import { toast } from "./toast";
import * as diag from "./diag";

export interface PickPost {
  outlet: string;
  /** `asking` · `waiting` · `sent` · `failed` · `skipped`. */
  state: string;
  dueTs?: number | null;
  remoteId?: string | null;
  error?: string | null;
}

export interface Pick {
  id: number;
  /** `app` (marked here) · `import` (the owner's journal, §8.13). */
  source: string;
  /** The journal day, `YYYY-MM-DD`. */
  day: string;
  trackId: string;
  /** The song as it was at mark time. */
  meta: Track;
  note?: string | null;
  markedAt: number;
  posts: PickPost[];
}

export interface OutletStatus {
  outlet: string;
  connected: boolean;
  on: boolean;
  /** The webhook's own name — what the status line calls the place.*/
  whereTo: string;
  defaultName: string;
  error?: string | null;
}

/** The rows Rust owns (settings.rs), cached here the way the Settings card caches its own. */
interface SotdSettings {
  sotd: boolean;
  sotdDayStart: number;
  sotdPicksPerDay: number;
  sotdPostMode: "ask" | "now" | "time";
  sotdPostAt: string;
  sotdPostAs: string;
}

const err = (what: string) => (e: unknown) => console.error(`[sotd] ${what}`, e);

let picks: Pick[] = [];
let today = "";
let outlets: OutletStatus[] = [];
let conf: SotdSettings = { sotd: true, sotdDayStart: 5, sotdPicksPerDay: 1, sotdPostMode: "ask", sotdPostAt: "20:00", sotdPostAs: "" };
let ready = false;

const listeners = new Set<() => void>();
export function onSotdChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const emit = () => listeners.forEach((cb) => cb());

// ── reading ───────────────────────────────────────────────────────────────────

/** Is the feature on? Off hides the menu items, the shelf, the suggestion and Rewind's Picks. */
export const sotdOn = (): boolean => conf.sotd;
export const sotdReady = (): boolean => ready;
export const sotdSettings = (): SotdSettings => conf;
export const outletStatuses = (): OutletStatus[] => outlets;
/** The outlets a pick would go to right now: set up AND on. */
export const liveOutlets = (): OutletStatus[] => outlets.filter((o) => o.connected && o.on);

/** Every pick, newest day first. */
export const allPicks = (): Pick[] => picks;
export const picksOn = (day: string): Pick[] => picks.filter((p) => p.day === day);
export const todayDay = (): string => today;
export const todayPicks = (): Pick[] => picksOn(today);

/** Is this song already a pick today? */
export const pickOfToday = (t: Track): Pick | undefined =>
  t.catalogId ? todayPicks().find((p) => p.trackId === t.catalogId) : undefined;

/** At the limit, Mark becomes Replace. 0 picks per day means no limit. */
export const atLimit = (): boolean => conf.sotdPicksPerDay > 0 && todayPicks().length >= conf.sotdPicksPerDay;

const refreshConf = async () => {
  const [s, o, t] = await Promise.all([
    invoke<SotdSettings>("settings_get"),
    invoke<OutletStatus[]>("outlet_status"),
    invoke<string>("pick_today"),
  ]);
  conf = { ...conf, ...s };
  outlets = o;
  today = t;
};

const refreshPicks = async () => {
  picks = await invoke<Pick[]>("picks_list", { from: null, to: null });
};

/** Read everything again — after a mark, a connect, a settings change, a day rollover. */
export async function reloadSotd(): Promise<void> {
  await Promise.all([refreshConf(), refreshPicks()]);
  emit();
}

// ── the day, in words ─────────────────────────────────────────────────────────

const dayShift = (n: number): string => {
  const d = new Date();
  d.setHours(d.getHours() - conf.sotdDayStart);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** "Today" · "Yesterday" · "Tue, Sep 16" — the sub line of a shelf tile and a Rewind row. */
export function dayLabel(day: string): string {
  if (day === today) return "Today";
  if (day === dayShift(-1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "8:00 PM" from `20:00`, in the user's own clock format. */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 20, m ?? 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** What a pick's posts add to its sub line: " · 8:00 PM", " · Not posted", or nothing. */
export function postNote(p: Pick): string {
  if (!p.posts.length) return "";
  if (p.posts.some((x) => x.state === "waiting" && x.dueTs)) return ` · ${timeLabel(conf.sotdPostAt)}`;
  if (p.posts.every((x) => x.state === "sent")) return "";
  if (p.posts.some((x) => x.state === "withdrawn")) return " · Withdrawn";
  if (p.posts.some((x) => x.state === "failed" || x.state === "skipped")) return " · Not posted";
  return "";
}

/** Did this pick actually reach an outlet, and is it still there? Only then can it be pulled. */
export const isPosted = (p: Pick): boolean => p.posts.some((x) => x.state === "sent");

/** `dueTs` is `at` on a `PickPost`; the type carries both, so a state's own marker is honest. */
export interface PostRecord {
  pickId: number;
  day: string;
  title: string;
  artist: string;
  outlet: string;
  state: string;
  at?: number | null;
  error?: string | null;
}

/** Everything that has left the app, newest first (§10.7). Names and states only. */
export const postLog = (): Promise<PostRecord[]> => invoke<PostRecord[]>("post_log");

/** One record as a line of plain text, for the Copy button. */
export const postLine = (r: PostRecord): string => {
  const when = r.at ? new Date(r.at).toLocaleString() : "—";
  const why = r.error ? ` (${r.error})` : "";
  return `${when}  ${STATE_WORD[r.state] ?? r.state}  ${outletName(r.outlet)}  “${r.title}” — ${r.artist}  [${r.day}]${why}`;
};

/** The words the record uses. Plain, and true about what happened. */
export const STATE_WORD: Record<string, string> = {
  sent: "Posted",
  withdrawn: "Withdrawn",
  failed: "Failed",
  skipped: "Not posted",
  waiting: "Waiting",
  asking: "Asking you",
};

export const outletName = (o: string): string =>
  o === "discord" ? "Discord" : o === "bluesky" ? "Bluesky" : o === "mastodon" ? "Mastodon" : o;

/** "Discord", "Discord and Bluesky", "Discord, Bluesky and Mastodon". */
export function outletsText(names: string[]): string {
  const ns = names.map(outletName);
  if (ns.length <= 1) return ns[0] ?? "";
  return `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}

// ── marking ───────────────────────────────────────────────────────────────────

const undoAction = (id: number) => ({
  label: "Undo",
  run: () => void unmark(id, true).catch(err("undo")),
});

/** Mark a song. Rust decides the day and enforces the limit; this shows what happened. */
export async function mark(t: Track, opts?: { replace?: boolean; note?: string }): Promise<void> {
  try {
    const r = await invoke<{ pick: Pick; orphans: { outlet: string; remoteId: string }[] }>("pick_mark", {
      track: t,
      note: opts?.note ?? null,
      replace: opts?.replace ?? false,
    });
    diag.log("sotd:mark", { day: r.pick.day });
    await reloadSotd();
    // A replaced pick had already gone out: offer to take the posts down too (9d).
    if (r.orphans.length) {
      toast({
        kind: "info",
        sticky: true,
        text: "Also delete the posts of the pick you replaced?",
        actions: [
          { label: "Delete", run: () => void invoke("pick_delete_posts", { orphans: r.orphans }).catch(err("delete posts")) },
          { label: "Keep" },
        ],
      });
    }
    const live = liveOutlets();
    // Ask each time: the toast comes from the `sotd-ask` event, so an agent's mark asks too.
    if (conf.sotdPostMode === "ask" && live.length) return;
    // Right away: the toast comes from the `sotd-posted` event, with the real result.
    if (conf.sotdPostMode === "now" && live.length) return;
    const text =
      conf.sotdPostMode === "time" && live.length
        ? `Posts at ${timeLabel(conf.sotdPostAt)}.`
        : `Today's Song of the Day: “${t.title}”.`;
    toast({ kind: "success", text, actions: [undoAction(r.pick.id)] });
  } catch (e) {
    const why = String(e);
    if (why.includes("sotd-off")) return; // the row is off; the menu item is not there either
    if (why.includes("already-picked")) {
      toast({ kind: "info", text: "That is already today's Song of the Day." });
      return;
    }
    console.error("[sotd] mark", e);
    toast({ kind: "warn", text: "Couldn't mark that song." });
  }
}

export async function unmark(id: number, deletePost: boolean): Promise<void> {
  await invoke("pick_unmark", { id, deletePost });
  diag.log("sotd:unmark", { id });
  await reloadSotd();
}

/** Unmark, asking first when a post already went out (9d: Delete is the first button). */
export function unmarkAsking(p: Pick): void {
  const sent = p.posts.some((x) => x.state === "sent");
  if (!sent) {
    void unmark(p.id, false).catch(err("unmark"));
    return;
  }
  toast({
    kind: "info",
    sticky: true,
    text: `Also delete the ${outletsText(p.posts.filter((x) => x.state === "sent").map((x) => x.outlet))} post?`,
    actions: [
      { label: "Delete", run: () => void unmark(p.id, true).catch(err("unmark")) },
      { label: "Keep", run: () => void unmark(p.id, false).catch(err("unmark")) },
    ],
  });
}

/** Take the posted message down and keep the pick (§10.7). It asks first: putting the same
 *  message back is not possible — a repost is a new message, with a new time in the channel. */
export function withdrawAsking(p: Pick): void {
  const where = outletsText(p.posts.filter((x) => x.state === "sent").map((x) => x.outlet));
  toast({
    kind: "info",
    sticky: true,
    text: `Take the ${where} post for “${p.meta.title}” down? Your pick stays.`,
    actions: [
      {
        label: "Withdraw",
        run: () =>
          void invoke("pick_withdraw", { id: p.id })
            .then(() => {
              diag.log("sotd:withdraw", { id: p.id });
              toast({ kind: "success", text: `Withdrawn from ${where}. The pick is still yours.` });
              return reloadSotd();
            })
            .catch((e) => {
              console.error("[sotd] withdraw", e);
              toast({ kind: "warn", text: "Couldn't take the post down." });
            }),
      },
      { label: "Keep" },
    ],
  });
}

/** The same question, reached by a pick's id — what the record's own Withdraw button has. */
export function withdrawPickAsking(pickId: number): void {
  const p = picks.find((x) => x.id === pickId);
  if (p) withdrawAsking(p);
}

export async function setNote(id: number, note: string): Promise<void> {
  await invoke("pick_note", { id, note: note.trim() || null });
  await reloadSotd();
}

export const postNow = (id: number): Promise<void> => invoke<void>("pick_post", { id }).then(() => reloadSotd());

// ── the menu rows ─────────────────────────────────────────────────────────────

/** The one row `trackMenu` adds (§8.5). Null when the feature is off, or when the song has
 *  no catalog id — there would be nothing to post and nothing Apple could resolve. */
export function markItem(items: Track[], context?: string): MenuItem | null {
  if (!conf.sotd || items.length !== 1) return null;
  // A pick's own tile carries the verbs already (`pickMenu`), and the row there must act on
  // THAT pick's day, not on today's.
  if (context === "picks") return null;
  const t = items[0];
  if (!t.catalogId) return null;
  const mine = pickOfToday(t);
  if (mine) return { label: "Unmark Song of the Day", run: () => unmarkAsking(mine) };
  if (atLimit()) return { label: "Replace Today's Pick", run: () => void mark(t, { replace: true }).catch(err("mark")) };
  return { label: "Mark as Song of the Day", run: () => void mark(t).catch(err("mark")) };
}

/** The extra rows a pick's own tile carries: the note field, Post Now, and Unmark. */
export function pickMenu(p: Pick): MenuItem[] {
  const rows: MenuItem[] = [
    {
      input: {
        label: p.note ? "Note" : "Add a note",
        value: p.note ?? "",
        placeholder: "A line to post with it",
        onSubmit: (v: string) => void setNote(p.id, v).catch(err("note")),
      },
    },
  ];
  const unsent = p.posts.some((x) => x.state !== "sent");
  if (liveOutlets().length && (unsent || !p.posts.length)) {
    rows.push({ label: "Post Now", run: () => void postNow(p.id).catch(err("post now")) });
  }
  if (isPosted(p)) rows.push({ label: "Withdraw the post", run: () => withdrawAsking(p) });
  rows.push({ label: p.source === "import" ? "Remove from Songs of the Day" : "Unmark Song of the Day", run: () => unmarkAsking(p) });
  return rows;
}

// ── the shelf ─────────────────────────────────────────────────────────────────

/** One pick as a Home tile: the song, with its day (and its post state) as the sub line. */
export function pickTile(p: Pick): HomeItem {
  const it = songItem(p.meta);
  return { ...it, key: `pick:${p.id}`, sub: `${dayLabel(p.day)}${postNote(p)}`, context: "picks" };
}

/** Home's last shelf (owner, 2026-09-18): the picks, newest first. */
export const pickTiles = (cap: number): HomeItem[] => picks.slice(0, cap).map(pickTile);

/** The pick a shelf tile stands for. */
export const pickByKey = (key: string): Pick | undefined => picks.find((p) => `pick:${p.id}` === key);

// ── boot ──────────────────────────────────────────────────────────────────────

/** From main.ts: the mirror, the Ask toast, the post results, and the missed set times. */
export async function initSotd(): Promise<void> {
  await reloadSotd().catch(err("init"));
  ready = true;
  emit();

  void listen("sotd-changed", () => void reloadSotd().catch(err("changed")));

  // The Ask toast. It fires for a mark made anywhere — a right-click here, or an agent.
  void listen<{ id: number; title: string; outlets: string[] }>("sotd-ask", (e) => {
    const { id, title, outlets: to } = e.payload;
    toast({
      kind: "info",
      sticky: true,
      text: `Post “${title}” to ${outletsText(to)}?`,
      actions: [
        { label: "Post", run: () => void postNow(id).catch(err("post")) },
        { label: "Not now", run: () => void invoke("pick_skip", { id }).then(() => reloadSotd()).catch(err("skip")) },
      ],
    });
  });

  // What a send did. Right away has no toast of its own, so this is the only word on it.
  void listen<{ id: number; title: string; outlet: string; ok: boolean; error?: string }>("sotd-posted", (e) => {
    const { id, title, outlet, ok, error } = e.payload;
    if (ok) {
      toast({ kind: "success", text: `Posted “${title}” to ${outletName(outlet)}.`, actions: [undoAction(id)] });
    } else {
      toast({ kind: "warn", text: `${outletName(outlet)} did not take the post: ${error ?? "no reason given"}.` });
    }
  });

  // A set time that went by while the app was closed, on a day that has since ended (§8.5).
  const missed = await invoke<{ id: number; title: string; day: string }[]>("picks_missed").catch(() => []);
  for (const m of missed) {
    toast({
      kind: "info",
      sticky: true,
      text: `Post “${m.title}” now? It will count for today, not ${dayLabel(m.day)}.`,
      actions: [
        { label: "Post", run: () => void postNow(m.id).catch(err("post missed")) },
        { label: "Skip", run: () => void invoke("picks_missed_skip", { id: m.id }).then(() => reloadSotd()).catch(err("skip missed")) },
      ],
    });
  }
}

/** The Settings card and the agent write these through Rust, then tell us. */
export const refreshSotdSettings = (): Promise<void> => reloadSotd();

// ── the suggestion (option C) ─────────────────────────────────────────────────

/** Suggest today's pick: the song you listened to most today. Off by default — people
 *  prefer to find what they like themselves (owner's words). */
export const suggestOn = (): boolean => conf.sotd && setting("sotdSuggest");

/** Under this much listening today, the day has not said anything yet: no suggestion. */
const SUGGEST_FLOOR_MS = 10 * 60_000;
/** The suggestion tile's key, so the shelf's menu knows which tile it is. */
export const SUGGEST_KEY = "pick:suggest";

/** Today's most-listened song, if there is room for a pick and the day has enough in it.
 *  `play_events` only: local, zero Apple calls. */
export async function suggestionTile(): Promise<HomeItem | null> {
  if (!suggestOn() || atLimit()) return null;
  // The journal day's own start, which is not always midnight.
  const [y, m, d] = today.split("-").map(Number);
  if (!y || !m || !d) return null;
  const from = new Date(y, m - 1, d, conf.sotdDayStart, 0, 0, 0).getTime();
  const events = await playEventsSince(from).catch(() => []);
  const ms = new Map<string, number>();
  for (const e of events) ms.set(e.trackId, (ms.get(e.trackId) ?? 0) + (e.msListened ?? 0));
  const picked = new Set(todayPicks().map((p) => p.trackId));
  let best: { t: Track; ms: number } | null = null;
  for (const [id, total] of ms) {
    if (total < SUGGEST_FLOOR_MS) continue;
    const t = trackById(id);
    if (!t?.catalogId || picked.has(t.catalogId)) continue;
    if (!best || total > best.ms) best = { t, ms: total };
  }
  if (!best) return null;
  return { ...songItem(best.t), key: SUGGEST_KEY, sub: "Most played today", context: "picks", dashed: true };
}

/** The suggestion's own row order: Mark comes first, because that is what it is for. */
export const suggestMarkItem = (t: Track): MenuItem => ({
  label: atLimit() ? "Replace Today's Pick" : "Mark as Song of the Day",
  run: () => void mark(t, { replace: atLimit() }).catch(err("mark suggestion")),
});
