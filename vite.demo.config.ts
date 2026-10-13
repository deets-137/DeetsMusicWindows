// The web demo's build (docs/features/WEB-DEMO.md). The real `src/` and the real index.html,
// with two changes made to the page as it is served: the MusicKit CDN script goes, and
// demo/boot.ts takes main.ts's place: it reads the feed, then loads the shim (demo/shim.ts)
// and then main.ts. Nothing in `src/` knows about the demo.
//
//   npm run demo         a dev server (a free port from 1430 up)
//   npm run demo:build   dist-web/ — what deets.solutions/deetsmusic/demo/app/ serves

import { defineConfig, type Plugin } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version: string = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// The first look follows the site's own theme and skin (deets.solutions stores them as
// `deets-theme` / `deets-skin`, the app as the settings store's `theme` / `skin` since
// 2026-09-26, RULES.md §7a; the ids are the same). Written only while the visitor has no look
// of their own. It runs before the page's own pre-paint script, which then reads the store.
const SEED_LOOK = `<script>
  (function () {
    try {
      var look = JSON.parse(localStorage.getItem("deets.settings") || "{}");
      var pairs = [["deets-theme", "theme"], ["deets-skin", "skin"]], seeded = false;
      for (var i = 0; i < pairs.length; i++) {
        var site = localStorage.getItem(pairs[i][0]);
        if (site && !look[pairs[i][1]]) { look[pairs[i][1]] = site; seeded = true; }
      }
      if (seeded) localStorage.setItem("deets.settings", JSON.stringify(look));
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
        if (s.hiddenCards === undefined) s.hiddenCards = []; // the unlock takes Rewind out of the hidden list (HIDE-CARDS.md)
        changed = true;
      }
      if (changed) localStorage.setItem("deets.settings", JSON.stringify(s));
    } catch (e) {}
  })();
</script>`;

// The owner's Songs of the Day (WEB-DEMO.md §15). The demo reads `/sotd/songs.json` from the
// site when it loads. The dev server serves that path from the DeetsSolutions checkout beside
// this repo, and the build carries a copy of his picks for a load that cannot read the feed
// (fork 7A). The copy keeps only his rows and only the fields the demo reads: no author.
const FEED_FILE = fileURLToPath(new URL("../DeetsSolutions/sotd/songs.json", import.meta.url));
const OWNER = "Deets";
const KEEP = ["posted_at", "date", "track_name", "artist_name", "album", "genre", "duration_sec", "release_date", "release_year", "apple_music_url", "preview_url", "artwork_url"];
const PICKS_ID = "virtual:sotd-picks";

function sotdPicks(): Plugin {
  let building = false;
  return {
    name: "deets-demo-sotd",
    configResolved(c) {
      building = c.command === "build";
    },
    resolveId(id) {
      return id === PICKS_ID ? "\0" + PICKS_ID : null;
    },
    load(id) {
      if (id !== "\0" + PICKS_ID) return null;
      if (!existsSync(FEED_FILE)) {
        const msg = `[demo] no Songs of the Day feed at ${FEED_FILE}: is ../DeetsSolutions checked out?`;
        if (building) throw new Error(msg);
        this.warn(msg);
        return "export default [];";
      }
      this.addWatchFile(FEED_FILE);
      const songs: Record<string, unknown>[] = JSON.parse(readFileSync(FEED_FILE, "utf8")).songs ?? [];
      const rows = songs
        .filter((s) => s.author === OWNER)
        .map((s) => Object.fromEntries(KEEP.filter((k) => s[k] != null).map((k) => [k, s[k]])));
      if (building && !rows.length) throw new Error(`[demo] the feed has no picks by ${OWNER}`);
      // The author is set back on each row: the demo's own filter reads it, the same as on the feed.
      return `export default ${JSON.stringify(rows.map((r) => ({ ...r, author: OWNER })))};`;
    },
    configureServer(server) {
      server.middlewares.use("/sotd/songs.json", (_req, res) => {
        if (!existsSync(FEED_FILE)) {
          res.statusCode = 404;
          return void res.end();
        }
        res.setHeader("Content-Type", "application/json");
        res.end(readFileSync(FEED_FILE));
      });
    },
  };
}

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
          // demo/boot.ts loads the shim, then main.ts, once the feed is read (WEB-DEMO.md §15.3).
          .replace(main, `<script type="module" src="/demo/boot.ts"></script>`);
      },
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [demoPage(), sotdPicks()],
  define: { __DEMO_VERSION__: JSON.stringify(version) },
  // The catalog waits for the feed before the app starts (a top-level await in demo/catalog.ts).
  esbuild: { target: "es2022" },
  build: {
    target: "es2022",
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
