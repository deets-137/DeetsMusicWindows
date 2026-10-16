// The updater's front half (RELEASE.md §6.3–6.5). Rust (`update.rs`, Velopack underneath:
// docs/ops/VELOPACK.md) checks, downloads, verifies and installs; this module decides WHEN,
// from Settings › Updates, and asks through toasts:
//   Automatic — check 30 s after launch and every 6 h; download in the background; then
//               offer the restart (Restart now / Later / Skip this version).
//   Ask       — ask before the download (Download / Later / Skip this version).
//   Off       — no scheduled check; Settings › Updates › Check now still works.
// A downloaded version installs at the next start whatever is pressed, so "Later" means "at
// the next start" (his call F1 A, VELOPACK.md §1). "Skip this version" holds it until a newer
// one exists (`updateSkip`) and deletes its downloaded package, or the next start would apply
// it. A version under the Worker's `minVersion` is required: it downloads whatever the mode,
// and its toast has no Skip.
// Rollback (Settings › Updates › Roll back) asks the Worker for an older version in the same
// channel group, downloads it, and asks to restart. The version it leaves is skipped, or
// Automatic would install it again at once.
// Before the install the queue blob is written with the playback position (queue-persist),
// because the installer ends the process and no unload save runs.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast, type ToastAction, type ToastHandle } from "./toast";
import { setting, setSetting } from "./settings-store";
import { flushForRestart } from "./queue-persist";
import * as diag from "./diag";
import { compareVersions, rollbackSkip } from "./update-rules";

export interface UpdateStatus {
  state: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  current: string;
  channel: string;
  version: string | null;
  notes: string | null;
  size: number | null;
  got: number;
  rollback: boolean;
  error: string | null;
}

export interface OlderVersion {
  version: string;
  notes: string;
  pub_date: string | null;
  size: number;
}

const FIRST_CHECK_MS = 30_000; // after launch settles (the token fetch, the library load)
const CHECK_EVERY_MS = 6 * 60 * 60_000;

let status: UpdateStatus | null = null;
let checked = false; // a check answered this session, so "Up to date" means something
let nextAt: number | null = null; // the next scheduled check (the updates panel shows it)
let laterFor: string | null = null;
let minVersion: string | null = null;
let offer: ToastHandle | null = null;
let older: Promise<OlderVersion[]> | null = null;
const subs = new Set<(s: UpdateStatus | null) => void>();

export function onUpdateStatus(cb: (s: UpdateStatus | null) => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

function take(s: UpdateStatus): UpdateStatus {
  status = s;
  subs.forEach((cb) => cb(s));
  return s;
}

export { compareVersions };

const isRequired = (s: UpdateStatus): boolean =>
  !!minVersion && !s.rollback && compareVersions(s.current, minVersion) < 0;

/** One offer on screen at a time; a new one replaces it. A question shows under every tier. */
function ask(text: string, actions: ToastAction[]): void {
  offer?.dismiss();
  offer = toast({ kind: "info", text, sticky: true, actions });
}

/** Check once. `manual` (Check now) also offers a skipped version, or one put off with Later. */
export async function checkForUpdate(manual = false): Promise<UpdateStatus | null> {
  let s: UpdateStatus;
  try {
    s = take(await invoke<UpdateStatus>("update_check", { target: null }));
  } catch (e) {
    diag.warn("update:check", { error: String(e) });
    return null;
  }
  if (s.state === "error") return s; // Rust logged it; the Settings status line shows it
  checked = true;
  if (!s.version || s.rollback) return s;
  const required = isRequired(s);
  if (!required && !manual && (s.version === setting("updateSkip") || s.version === laterFor)) return s;
  const mode = setting("updateMode");
  if (!required && !manual && mode === "off") return s;
  if (s.state === "ready") offerRestart(s);
  else if (required || mode === "auto") void download();
  else offerDownload(s);
  return s;
}

function offerDownload(s: UpdateStatus): void {
  const v = s.version!;
  ask(`DeetsMusic ${v} is available.`, [
    { label: "Download", run: () => void download() },
    { label: "Later", run: () => void (laterFor = v) },
    { label: "Skip this version", run: () => setSetting("updateSkip", v) },
  ]);
}

/** The last status Rust reported (null before the first answer). */
export const updateStatus = (): UpdateStatus | null => status;

/** Download the offered version, then ask to restart (also the agent's `update install`). */
export async function download(): Promise<void> {
  let s: UpdateStatus;
  try {
    s = take(await invoke<UpdateStatus>("update_download"));
  } catch (e) {
    diag.warn("update:download", { error: String(e) });
    return;
  }
  if (s.state === "ready") offerRestart(s);
  else if (s.state === "error") {
    toast({
      kind: "warn",
      text: s.rollback
        ? "Couldn't download that version. Try again later."
        : "Couldn't download the update. DeetsMusic will try again later.",
    });
  }
}

export function offerRestart(s: UpdateStatus): void {
  const v = s.version!;
  const required = isRequired(s);
  const text = s.rollback
    ? `DeetsMusic ${v} is ready. Restart to roll back.`
    : required
      ? `This version of DeetsMusic is no longer supported. Restart to update to ${v}.`
      : `DeetsMusic ${v} is ready. Restart now, or it installs the next time DeetsMusic starts.`;
  const actions: ToastAction[] = [
    { label: "Restart now", run: () => void restartNow() },
    { label: "Later", run: () => void (laterFor = v) },
  ];
  if (!required && !s.rollback) actions.push({ label: "Skip this version", run: () => void skipVersion(v) });
  ask(text, actions);
}

/** Skip a version (the toast, and the agent's `update skip`): remember the skip, and when that
 *  version is already downloaded, delete the package the next start would apply. "" clears it. */
export async function skipVersion(v: string): Promise<void> {
  setSetting("updateSkip", v);
  if (!v || status?.version !== v || status.state !== "ready" || status.rollback) return;
  try {
    take(await invoke<UpdateStatus>("update_discard"));
  } catch (e) {
    diag.warn("update:discard", { error: String(e) });
  }
}

/** Install the ready update: save the session, then Rust runs the installer and exits. */
export async function restartNow(): Promise<void> {
  const s = status;
  if (!s || s.state !== "ready") return;
  const skipWas = setting("updateSkip");
  if (s.rollback) setSetting("updateSkip", rollbackSkip(skipWas, s.current)); // update-rules.ts
  await flushForRestart();
  diag.log("update:install", { from: s.current, to: s.version, rollback: s.rollback });
  diag.flush();
  try {
    await invoke("update_install"); // does not return on success: the process exits
  } catch (e) {
    if (s.rollback) setSetting("updateSkip", skipWas);
    const msg = String(e);
    toast({ kind: "warn", text: msg.includes("dev build") ? msg : "Couldn't install the update. Try again." });
  }
}

/** Older versions in this version's channel group, newest first. One request per session.
 *  Only a non-empty list is kept: a build that starts before it is published is unknown to
 *  the Worker (`current: null`, no versions), and keeping that empty answer hid Roll back's
 *  list for the whole session (0.12.2, 2026-09-20). */
export function olderVersions(): Promise<OlderVersion[]> {
  older ??= invoke<{ versions?: OlderVersion[] }>("update_versions")
    .then((r) => {
      const list = Array.isArray(r?.versions) ? r.versions : [];
      if (!list.length) older = null; // ask again next time the card opens
      return list;
    })
    .catch((e) => {
      diag.warn("update:versions", { error: String(e) });
      older = null; // try again next time the card opens
      return [];
    });
  return older;
}

/** Settings › Updates › Roll back: get that version, then ask to restart. */
export async function rollbackTo(version: string): Promise<void> {
  let s: UpdateStatus;
  try {
    s = take(await invoke<UpdateStatus>("update_check", { target: version }));
  } catch (e) {
    diag.warn("update:rollback", { error: String(e) });
    return;
  }
  if (!s.rollback || s.state === "error" || s.version !== version) {
    toast({ kind: "warn", text: `Couldn't get DeetsMusic ${version}. Try again later.` });
    return;
  }
  if (s.state === "ready") offerRestart(s);
  else await download();
}

/** The version a user reads and copies (Settings › Bugs, About; FUTURE-SETTINGS §23). A test
 *  build already says so in its number (`-t1`); a dev build and a build off the main channel
 *  with a plain number are named, so neither passes for a release. */
export function versionText(): string {
  const s = status;
  if (!s?.current) return "";
  if (import.meta.env.DEV) return `${s.current} · Dev build`;
  if (s.channel !== "deetsmusic" && !s.current.includes("-")) return `${s.current} · ${s.channel}`;
  return s.current;
}

/** When the next scheduled check runs (ms since the epoch), or null when none is scheduled. */
export const nextCheckAt = (): number | null => nextAt;

/** A dev build cannot update: Rust answers every check with this error. */
export const isDevBuild = (s: UpdateStatus): boolean => s.state === "error" && !!s.error?.includes("dev build");

/** What the status says, and its tone: "lit" = an update waits for you (the updates button's
 *  yellow), "bad" = the check failed. The updates panel's status line under the version and,
 *  with the version in front, the Settings › Updates status line (docs/features/UpdatesButton.md
 *  §9, his words 2026-10-16). */
export interface StatusWords {
  text: string;
  tone: "" | "lit" | "bad";
}

export function updateStatusWords(s: UpdateStatus | null = status): StatusWords {
  if (!s) return { text: "", tone: "" };
  const pct = s.size ? Math.min(100, Math.round((s.got / s.size) * 100)) : 0;
  switch (s.state) {
    case "checking":
      return { text: "Checking…", tone: "" };
    case "available":
      if (s.version === setting("updateSkip") && !isRequired(s)) return { text: `Skipped ${s.version}`, tone: "" };
      return { text: isRequired(s) ? `${s.version} is required` : `${s.version} is out`, tone: "lit" };
    case "downloading":
      return { text: `Getting ${s.version} · ${pct}%`, tone: "" };
    case "ready":
      return { text: s.rollback ? `Rolls back to ${s.version} on restart` : `${s.version} installs on restart`, tone: "lit" };
    case "error":
      if (isDevBuild(s)) return { text: "Dev build · no updates", tone: "" };
      return { text: "Couldn't reach the update server", tone: "bad" };
    default: {
      if (checked) return { text: "Up to date", tone: "" };
      // Before the first check, say how updates arrive (his call: the next check's time in
      // Automatic; only until the first check, 30 s after launch).
      const mode = setting("updateMode");
      if (mode === "off") return { text: "Updates are off", tone: "" };
      if (mode === "ask") return { text: "Asks before it downloads", tone: "" };
      return { text: nextAt ? `Next check for updates ${whenText(nextAt)}` : "Up to date", tone: "" };
    }
  }
}

/** "at 4:30 PM" today, "on 10/17 at 4:30 AM" on another day. */
function whenText(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `at ${time}`;
  return `on ${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} at ${time}`;
}

/** The Settings › Updates status line: the version, then the status words. A line about another
 *  version names it already, so it goes alone. */
export function updateStatusText(s: UpdateStatus | null = status): string {
  if (!s) return "";
  const words = updateStatusWords(s).text;
  const aboutOther = !!s.version && (s.state === "available" || s.state === "downloading" || s.state === "ready");
  return aboutOther ? words : `Version ${s.current} · ${words}`;
}

/** Is this offer a required update (under the worker's `minVersion`)? */
export const isRequiredUpdate = (s: UpdateStatus): boolean => isRequired(s);

/** Boot (main.ts): follow Rust's status, read `minVersion`, schedule the checks. */
export function initUpdater(): void {
  void listen<UpdateStatus>("update-state", (e) => take(e.payload));
  invoke<UpdateStatus>("update_status").then(take).catch((e) => diag.warn("update:status", { error: String(e) }));
  invoke<{ minVersion?: unknown }>("apple_remote_config")
    .then((cfg) => {
      if (typeof cfg?.minVersion === "string") minVersion = cfg.minVersion;
    })
    .catch(() => {});
  const tick = (): void => {
    // A rollback waiting for its restart must not be replaced by a forward offer.
    if (status?.rollback && (status.state === "ready" || status.state === "downloading")) return;
    const required = !!status && !!minVersion && compareVersions(status.current, minVersion) < 0;
    if (setting("updateMode") === "off" && !required) return;
    void checkForUpdate(false);
  };
  nextAt = Date.now() + FIRST_CHECK_MS;
  window.setTimeout(() => {
    nextAt = Date.now() + CHECK_EVERY_MS;
    tick();
    window.setInterval(() => {
      nextAt = Date.now() + CHECK_EVERY_MS;
      tick();
    }, CHECK_EVERY_MS);
  }, FIRST_CHECK_MS);
}
