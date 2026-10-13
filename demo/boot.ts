// The web demo's entry (WEB-DEMO.md §15.3). The catalog reads the Songs of the Day feed before
// anything else runs (a top-level await in catalog.ts), so the shim and then the app's own
// main.ts are loaded from here, in that order, after the feed.
//
// main.ts starts on the page's DOMContentLoaded. A slow feed can let that event pass before
// main.ts is loaded, so it is sent again to `window` (main.ts listens there) in that case.

let parsed = false;
window.addEventListener("DOMContentLoaded", () => (parsed = true), { once: true });

await import("./shim");
await import("../src/main");
if (parsed) window.dispatchEvent(new Event("DOMContentLoaded"));

export {};
