// Lightweight diagnostics — an in-memory ring buffer of timestamped events plus a
// console handle (window.__diag). The buffer ALWAYS records (bounded, cheap); the
// console echo is opt-in via localStorage "deets.debug" = "1" (or __diag.echo(true)).
//
// This buffer is the payload the in-app "Report a problem" action attaches, so users
// can file actionable bug reports without us reading minds. It also auto-captures
// uncaught errors / promise rejections — exactly the class we hit (the "play()
// without a previous stop()/pause()" rejection).
//
// It reaches disk through `flush()` → the Rust `diag_flush` command, which appends
// `report()` to the rolling app log (LOGGING.md). Normal use writes nothing extra:
// the triggers are an uncaught error (throttled), `beforeunload`, and the report
// form opening — so a crash still leaves a trace.

import { invoke } from "@tauri-apps/api/core";

export interface DiagEvent {
  n: number; // sequence number, monotonic for the session — what a flush counts from
  t: number; // ms since page load (monotonic)
  tag: string; // e.g. "player:play", "player:desync"
  data?: unknown; // small JSON-able snapshot
}

const CAP = 300;
const buffer: DiagEvent[] = [];
let seq = 0; // the last number handed out; `flushedSeq` is how far the file has it
let flushedSeq = 0;

let echo = false;
try {
  echo = localStorage.getItem("deets.debug") === "1";
} catch {
  /* storage disabled */
}

export function log(tag: string, data?: unknown): void {
  buffer.push({ n: ++seq, t: Math.round(performance.now()), tag, data });
  if (buffer.length > CAP) buffer.shift();
  if (echo) console.debug(`[diag] ${tag}`, data ?? "");
}

// ── Warnings and errors reach the log file as they happen ─────────────────────────
// `log()` only fills the ring. `warn()` / `error()` also write one line through the Rust
// `log_event` command (rate-limited there), so a release log shows a failure without a
// crash or an unload. Same tag + data within DEDUPE_MS is sent once.
type Level = "warn" | "error";
const DEDUPE_MS = 2000;
let lastSent = { key: "", at: -Infinity };
function send(level: Level, tag: string, data?: unknown): void {
  let text: string | undefined;
  try {
    text = data === undefined ? undefined : JSON.stringify(data);
  } catch {
    text = String(data);
  }
  const key = `${level}|${tag}|${text ?? ""}`;
  const now = performance.now();
  if (key === lastSent.key && now - lastSent.at < DEDUPE_MS) return;
  lastSent = { key, at: now };
  invoke("log_event", { level, tag, data: text }).catch(() => {
    /* not under Tauri */
  });
}

export function warn(tag: string, data?: unknown): void {
  log(tag, data);
  send("warn", tag, data);
}

export function error(tag: string, data?: unknown): void {
  log(tag, data);
  send("error", tag, data);
}

export function events(): DiagEvent[] {
  return buffer.slice();
}

export function setEcho(on: boolean): void {
  echo = on;
  try {
    localStorage.setItem("deets.debug", on ? "1" : "0");
  } catch {
    /* storage disabled */
  }
}

/** A copy-pasteable text report of the recent log — the bug-report payload.
 *  `since` (a sequence number) keeps only the events after it, which is what a flush
 *  writes; the default is the whole ring, which is what the clipboard copy wants. */
export function report(since = 0): string {
  const events = since ? buffer.filter((e) => e.n > since) : buffer;
  const header = `DeetsMusic diag — ${new Date().toISOString()} — ${events.length} events`;
  const lines = events.map(
    (e) => `${String(e.t).padStart(8)}ms  ${e.tag}${e.data !== undefined ? "  " + JSON.stringify(e.data) : ""}`,
  );
  return [header, ...lines].join("\n");
}

/**
 * Append the events the file does not have yet to the app log. Fire-and-forget; never
 * throws.
 *
 * It writes only what is NEW (LOGGING.md §Auto-flush, the owner's call 2026-09-18).
 * Writing all 300 events on every flush is what filled the 512 KB file and rotated it
 * in 2026-09-13; the since-cursor is what makes a frequent flush affordable. Nothing
 * new means nothing written, so the timer below stays silent on an idle app.
 *
 * `all` re-writes the whole ring — `__diag.flush(true)` from the console, for when the
 * interesting part is already on disk but you want it in one block.
 */
export function flush(all = false): Promise<void> {
  if (!all && seq === flushedSeq) return Promise.resolve();
  const since = all ? 0 : flushedSeq;
  flushedSeq = seq;
  return invoke<void>("diag_flush", { text: report(since) }).catch((e) => {
    console.warn("[diag] flush failed", e); // not under Tauri, or the command is missing
  });
}

// ── The timer (LOGGING.md §Auto-flush) ───────────────────────────────────────
// A bug that does not throw used to leave NO front-end trace: the ring lived in memory
// and reached disk only on a crash, an unload, or the report form. The owner hit one on
// 2026-09-18 (a Home song tile, then an album's Play) and the file held the PREVIOUS
// session. The ring now lands every 5 minutes, gated on new events and writing only
// them.
const FLUSH_EVERY_MS = 5 * 60 * 1000;
window.setInterval(() => void flush(), FLUSH_EVERY_MS);

// One uncaught error tends to bring friends; write the buffer once per burst.
const FLUSH_GAP_MS = 5000;
let lastErrorFlush = -Infinity;
function flushOnError(): void {
  const now = performance.now();
  if (now - lastErrorFlush < FLUSH_GAP_MS) return;
  lastErrorFlush = now;
  flush();
}

async function copyReport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(report());
    console.log(`[diag] copied ${buffer.length} events to clipboard`);
  } catch {
    console.warn("[diag] clipboard unavailable — report follows:\n" + report());
  }
}

// Auto-capture uncaught errors and promise rejections. Checked on the next task so a later
// listener that swallows a KNOWN benign case (player.ts's MusicKit race filter calls
// preventDefault) keeps it out of the file.
window.addEventListener("error", (e) => {
  setTimeout(() => {
    if (e.defaultPrevented) return log("window:error", { msg: e.message, swallowed: true });
    error("window:error", { msg: e.message, src: e.filename, line: e.lineno });
    flushOnError();
  }, 0);
});
/** The top frames of a stack, origin stripped. A rejection has no filename or line of its own
 *  (the 2026-09-24 "reading 'includes'" ×22 could not be placed from the log). */
function topFrames(stack: unknown, n = 3): string | undefined {
  if (typeof stack !== "string") return undefined;
  const frames = stack
    .split("\n")
    .filter((l) => /^\s*at /.test(l))
    .slice(0, n)
    .map((l) => l.trim().replace(/^at /, "").split(location.origin).join(""));
  return frames.length ? frames.join(" < ") : undefined;
}
window.addEventListener("unhandledrejection", (e) => {
  setTimeout(() => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason?.message ?? e.reason);
    if (e.defaultPrevented) return log("window:unhandledrejection", { reason, swallowed: true });
    error("window:unhandledrejection", { reason, at: topFrames(e.reason?.stack) });
    flushOnError();
  }, 0);
});
// ── console.error / console.warn land here too (the consistency read, 2026-09-25) ──────
// About 200 failures were reported with `console.error` alone, which reaches DevTools and
// nothing else: a playlist, library, settings, tray or Now Playing failure never appeared
// in a bug report, while a player or room failure did. The console keeps printing; this
// only adds a copy. An error writes a line to the log file now (deduped and rate-limited
// like `error()`); a warning goes to the ring only and reaches the file with the next flush.
const CONSOLE_TEXT_MAX = 500;
function consoleText(args: unknown[]): string {
  const parts = args.map((a) => {
    if (a instanceof Error) return a.message;
    if (typeof a === "string") return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  });
  return parts.join(" ").slice(0, CONSOLE_TEXT_MAX);
}
let inConsoleHook = false; // a failed `log_event` must not come back through here
for (const level of ["error", "warn"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    if (inConsoleHook) return;
    const msg = consoleText(args);
    if (msg.startsWith("[diag]")) return; // this file's own complaints
    inConsoleHook = true;
    try {
      if (level === "error") error("console:error", { msg });
      else log("console:warn", { msg });
    } finally {
      inConsoleHook = false;
    }
  };
}

// On unload, whatever the timer has not written yet — at most one interval of events,
// because `flush` carries a since-cursor. (Before that cursor, this had to be gated on
// `dirty`: writing all 300 events on every reload filled the 512 KB file and rotated
// it, 2026-09-13.)
window.addEventListener("beforeunload", () => {
  flush();
});

// Console handle (available in prod too, so bug reports can be gathered anywhere).
(window as any).__diag = {
  events,
  report,
  copy: copyReport,
  flush,
  dump: () => console.table(buffer),
  /** The text a flush would write now — the events the log file does not have yet. */
  pending: () => report(flushedSeq),
  clear: () => {
    buffer.length = 0;
  },
  echo: setEcho,
};
