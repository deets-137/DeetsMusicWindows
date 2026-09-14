// The updater's front half (RELEASE.md §6.3–6.5). Rust (`update.rs`) checks, downloads,
// verifies and installs; this module decides WHEN, from Settings › Updates, and asks
// through toasts:
//   Automatic — check 30 s after launch and every 6 h; download in the background; then
//               ask to restart (Restart now / Later / Skip this version).
//   Ask       — ask before the download (Download / Later / Skip this version).
//   Off       — no scheduled check; Settings › Updates › Check now still works.
// "Later" holds that version until the next launch. "Skip this version" holds it until a
// newer one exists (`updateSkip`). A version under the Worker's `minVersion` is required:
// it downloads whatever the mode, and its toast has no Skip.
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

/** -1 / 0 / 1 on x.y.z; a pre-release sorts before its release. Unparseable = equal. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim());
    return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] ?? null } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

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

async function download(): Promise<void> {
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

function offerRestart(s: UpdateStatus): void {
  const v = s.version!;
  const required = isRequired(s);
  const text = s.rollback
    ? `DeetsMusic ${v} is ready. Restart to roll back.`
    : required
      ? `This version of DeetsMusic is no longer supported. Restart to update to ${v}.`
      : `DeetsMusic ${v} is ready. Restart to update.`;
  const actions: ToastAction[] = [
    { label: "Restart now", run: () => void restartNow() },
    { label: "Later", run: () => void (laterFor = v) },
  ];
  if (!required && !s.rollback) actions.push({ label: "Skip this version", run: () => setSetting("updateSkip", v) });
  ask(text, actions);
}

/** Install the ready update: save the session, then Rust runs the installer and exits. */
export async function restartNow(): Promise<void> {
  const s = status;
  if (!s || s.state !== "ready") return;
  const skipWas = setting("updateSkip");
  if (s.rollback) setSetting("updateSkip", s.current); // Automatic must not reinstall what you left
  await flushForRestart();
  diag.log("update:install", { from: s.current, to: s.version, rollback: s.rollback });
  diag.flush();
  try {
    await invoke("update_install"); // does not return on success: the process exits
  } catch (e) {
    if (s.rollback) setSetting("updateSkip", skipWas);
    const msg = String(e);
    toast({ kind: "warn", text: msg.includes("dev build") ? msg : "Couldn't start the installer. Try again." });
  }
}

/** Older versions in this version's channel group, newest first. One request per session. */
export function olderVersions(): Promise<OlderVersion[]> {
  older ??= invoke<{ versions?: OlderVersion[] }>("update_versions")
    .then((r) => (Array.isArray(r?.versions) ? r.versions : []))
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

/** The Settings › Updates status line. */
export function updateStatusText(): string {
  const s = status;
  if (!s) return "";
  const pct = s.size ? Math.min(100, Math.round((s.got / s.size) * 100)) : 0;
  switch (s.state) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return `DeetsMusic ${s.version} is available`;
    case "downloading":
      return `Downloading ${s.version} · ${pct}%`;
    case "ready":
      return `${s.version} is ready. Restart to ${s.rollback ? "roll back" : "update"}`;
    case "error":
      return `Version ${s.current}. Couldn't check or download the update`;
    default:
      return checked ? `Version ${s.current}. Up to date` : `Version ${s.current}`;
  }
}

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
  window.setTimeout(tick, FIRST_CHECK_MS);
  window.setInterval(tick, CHECK_EVERY_MS);
}
