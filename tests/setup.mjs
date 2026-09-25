// The whole test setup (his call, 2026-09-25: Node's built-in runner, no test dependency).
// `npm test` runs `node --import ./tests/setup.mjs --test tests/`. Node 24 strips the
// TypeScript types itself; this file adds the two things it lacks.
//
// Tests cover PURE logic only (CLAUDE.md: no harnesses for UI behaviour). A module that
// needs MusicKit or the DOM to load is not a target; move its rule into a small pure file
// instead (queue-sync.ts, layout-rules.ts, frame-period.ts).
import { registerHooks } from "node:module";

// 1. The app's imports carry no extension ("./settings-store"). Vite adds ".ts"; Node does not.
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec)) return next(spec + ".ts", ctx);
      throw e;
    }
  },
});

// 2. The browser globals a pure module touches when it loads: settings-store reads
//    localStorage and listens for "storage" events.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};

// 3. Tauri's window handle, which surface.ts takes when it loads. Only the label is read
//    there; any real Tauri call rejects, so a test can never reach the app by accident.
globalThis.__TAURI_INTERNALS__ ??= {
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  invoke: () => Promise.reject(new Error("no Tauri in tests")),
  transformCallback: () => 0,
};
