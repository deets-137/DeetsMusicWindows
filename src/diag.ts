// Lightweight diagnostics — an in-memory ring buffer of timestamped events plus a
// console handle (window.__diag). The buffer ALWAYS records (bounded, cheap); the
// console echo is opt-in via localStorage "deets.debug" = "1" (or __diag.echo(true)).
//
// This buffer is the payload a future in-app "Report a problem" action will attach,
// so users can file actionable bug reports without us reading minds. It also
// auto-captures uncaught errors / promise rejections — exactly the class we hit
// (the "play() without a previous stop()/pause()" rejection).

export interface DiagEvent {
  t: number; // ms since page load (monotonic)
  tag: string; // e.g. "player:play", "player:desync"
  data?: unknown; // small JSON-able snapshot
}

const CAP = 300;
const buffer: DiagEvent[] = [];

let echo = false;
try {
  echo = localStorage.getItem("deets.debug") === "1";
} catch {
  /* storage disabled */
}

export function log(tag: string, data?: unknown): void {
  buffer.push({ t: Math.round(performance.now()), tag, data });
  if (buffer.length > CAP) buffer.shift();
  if (echo) console.debug(`[diag] ${tag}`, data ?? "");
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

/** A copy-pasteable text report of the recent log — the future bug-report payload. */
export function report(): string {
  const header = `DeetsMusic diag — ${new Date().toISOString()} — ${buffer.length} events`;
  const lines = buffer.map(
    (e) => `${String(e.t).padStart(8)}ms  ${e.tag}${e.data !== undefined ? "  " + JSON.stringify(e.data) : ""}`,
  );
  return [header, ...lines].join("\n");
}

async function copyReport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(report());
    console.log(`[diag] copied ${buffer.length} events to clipboard`);
  } catch {
    console.warn("[diag] clipboard unavailable — report follows:\n" + report());
  }
}

// Auto-capture uncaught errors and promise rejections into the same log.
window.addEventListener("error", (e) =>
  log("window:error", { msg: e.message, src: e.filename, line: e.lineno }),
);
window.addEventListener("unhandledrejection", (e) =>
  log("window:unhandledrejection", {
    reason: e.reason instanceof Error ? e.reason.message : String(e.reason),
  }),
);

// Console handle (available in prod too, so bug reports can be gathered anywhere).
(window as any).__diag = {
  events,
  report,
  copy: copyReport,
  dump: () => console.table(buffer),
  clear: () => {
    buffer.length = 0;
  },
  echo: setEcho,
};
