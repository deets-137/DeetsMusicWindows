// The CSP on the dev app (docs/architecture/CSP.md §3, §12). A dev build loads its pages from
// Vite (`npm run dev:app`) or from `vite preview` (`--built`), never from the bundle, so Tauri's
// policy and csp.rs's hook never reach them. This plugin sends the same policy from Vite's
// servers: the one in tauri.conf.json, with each page's inline script hashes made the way Tauri
// makes them (CRLF to LF, SHA-256), plus what the dev server itself needs (its own port and hot
// reload, a local rooms or friends worker, and Vite's <style> tags on the plain dev server).
//
// Report-only by default, as the release is (§6). `DEETS_CSP=enforce npm run dev:app` enforces.
// A block lands in the diag ring and the log as `csp-<directive>:` (src/csp-watch.ts).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Every inline <script>'s hash in one HTML page, as tauri-codegen computes it. */
function inlineHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1]) || !m[2].length) continue;
    const text = m[2].replace(/\r\n?/g, "\n");
    out.push(`'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`);
  }
  return out;
}

function policy(root, htmlFile, serve) {
  const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const csp = conf.app?.security?.csp;
  if (!csp || typeof csp !== "object") return null;
  const map = Object.fromEntries(Object.entries(csp).map(([d, v]) => [d, Array.isArray(v) ? [...v] : String(v).split(/\s+/)]));
  const add = (d, ...s) => (map[d] = [...(map[d] ?? []), ...s]);
  add("connect-src", "http://localhost:*", "ws://localhost:*", "http://127.0.0.1:*", "ws://127.0.0.1:*");
  add("img-src", "http://localhost:*");
  if (serve) add("style-src", "'unsafe-inline'"); // Vite injects each CSS file as a <style> tag
  if (existsSync(htmlFile)) add("script-src", ...inlineHashes(readFileSync(htmlFile, "utf8")));
  return Object.entries(map).map(([d, s]) => `${d} ${s.join(" ")}`).join("; ");
}

export function cspDevPlugin() {
  const name = process.env.DEETS_CSP === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
  const middleware = (root, dir, serve) => (req, res, next) => {
    const path = (req.url ?? "/").split("?")[0];
    const page = path === "/" || path === "/index.html" ? "index.html" : path === "/tray.html" ? "tray.html" : null;
    if (page) {
      const value = policy(root, join(dir, page), serve);
      if (value) res.setHeader(name, value);
    }
    next();
  };
  return {
    name: "csp-dev",
    configureServer(server) {
      server.middlewares.use(middleware(server.config.root, server.config.root, true));
    },
    configurePreviewServer(server) {
      const root = server.config.root;
      server.middlewares.use(middleware(root, join(root, server.config.build.outDir), false));
    },
  };
}
