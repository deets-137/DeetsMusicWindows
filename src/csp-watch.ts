// What the Content Security Policy blocked (docs/architecture/CSP.md §6, §12.2). Each block goes
// to the diag ring as `csp:blocked`, and to the log as one `csp-<directive>:` WARN line through
// `csp_blocked`, which the weekly health counts carry per directive (his call C1). One line per
// directive + host + file per page load: a host MusicKit calls a thousand times counts once.
// index.html holds the blocks that came before this module loaded (`__cspEarly`).
import { invoke } from "@tauri-apps/api/core";
import { log } from "./diag";

declare global {
  interface Window {
    /** index.html's buffer of the CSP blocks before csp-watch.ts loads. */
    __cspEarly?: SecurityPolicyViolationEvent[];
  }
}

const seen = new Set<string>();

/** The host only, never the path: a song piece's URL carries a session key. */
function hostOf(uri: string): string {
  if (!uri) return "?";
  if (uri === "inline" || uri === "eval" || uri === "wasm-eval") return uri;
  try {
    const u = new URL(uri);
    return u.host || u.protocol;
  } catch {
    return uri.slice(0, 40);
  }
}

function report(e: SecurityPolicyViolationEvent): void {
  const directive = e.effectiveDirective || e.violatedDirective;
  const host = hostOf(e.blockedURI);
  const source = e.sourceFile ? `${hostOf(e.sourceFile)}${new URL(e.sourceFile, location.href).pathname}:${e.lineNumber}` : "page";
  const key = `${directive}|${host}|${source}`;
  if (seen.has(key)) return;
  seen.add(key);
  const reportOnly = e.disposition === "report";
  log("csp:blocked", { directive, host, source, reportOnly });
  invoke("csp_blocked", { directive, host, source, reportOnly }).catch(() => {
    /* not under Tauri */
  });
}

/** Start listening, and read the blocks index.html held. Call once, early. */
export function watchCsp(): void {
  document.addEventListener("securitypolicyviolation", report);
  const early = window.__cspEarly ?? [];
  window.__cspEarly = undefined;
  early.forEach(report);
}
