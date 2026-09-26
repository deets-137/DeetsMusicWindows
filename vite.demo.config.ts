// The web demo's build (docs/features/WEB-DEMO.md). The real `src/` and the real index.html,
// with two changes made to the page as it is served: the MusicKit CDN script goes, and the
// demo shim (demo/shim.ts) runs before main.ts. Nothing in `src/` knows about the demo.
//
//   npm run demo         a dev server (a free port from 1430 up)
//   npm run demo:build   dist-web/ — what deets.solutions/deetsmusic/demo/app/ serves

import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";

const version: string = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// The first look follows the site's own theme and skin (deets.solutions stores them as
// `deets-theme` / `deets-skin`, the app as `deets.theme` / `deets.skin`; the ids are the same).
// It runs before the page's own pre-paint script, which then reads the app keys as usual.
const SEED_LOOK = `<script>
  (function () {
    try {
      var pairs = [["deets-theme", "deets.theme"], ["deets-skin", "deets.skin"]];
      for (var i = 0; i < pairs.length; i++) {
        var site = localStorage.getItem(pairs[i][0]);
        if (site && !localStorage.getItem(pairs[i][1])) localStorage.setItem(pairs[i][1], site);
      }
    } catch (e) {}
    // The demo's own defaults (WEB-DEMO.md §11, his call 2026-09-26): Ocean's Album light
    // starts at 80, not the app's 0. Written only while the visitor has no value of their own,
    // so a change they make stays. Only these keys: the app fills every other one itself.
    try {
      var s = JSON.parse(localStorage.getItem("deets.settings") || "{}");
      var changed = false;
      if (s.oceanLight === undefined) {
        s.oceanLight = 80;
        changed = true;
      }
      // The demo's seeded plays pass Rewind's 50 starts at once, so a fresh visit (and every
      // Start over) showed "Rewind unlocked" over the page (his call 2026-09-26: fix it). The
      // unlock is written as done, with the card on, which is what the unlock itself does
      // (stats.ts), without the notice. The same "only while unset" rule as Album light.
      if (s.rewindAutoShown === undefined) {
        s.rewindAutoShown = true;
        s.rewindCard = true;
        changed = true;
      }
      if (changed) localStorage.setItem("deets.settings", JSON.stringify(s));
    } catch (e) {}
  })();
</script>`;

function demoPage(): Plugin {
  return {
    name: "deets-demo-page",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const musickit = /\s*<script src="https:\/\/js-cdn\.music\.apple\.com\/[^"]+"[^>]*><\/script>/;
        const main = /<script type="module" src="\/src\/main\.ts"[^>]*><\/script>/;
        if (!musickit.test(html) || !main.test(html)) throw new Error("[demo] index.html changed: update vite.demo.config.ts");
        return html
          .replace(musickit, "")
          .replace(/<head>/, `<head>\n    ${SEED_LOOK}`)
          .replace(main, (tag) => `<script type="module" src="/demo/shim.ts"></script>\n    ${tag}`);
      },
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [demoPage()],
  define: { __DEMO_VERSION__: JSON.stringify(version) },
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    rollupOptions: { input: { main: "index.html" } },
  },
  clearScreen: false,
  server: {
    port: Number(process.env.VITE_PORT) || 1430,
    strictPort: false, // several Deets* apps run on this PC at once: take the next free port
    watch: { ignored: ["**/src-tauri/**", "**/cli/target/**", "**/dist-web/**"] },
  },
});
