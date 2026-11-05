// `virtual:sotd-picks`: the owner's Songs of the Day, copied from the feed at build time. The web
// demo falls back on it (WEB-DEMO.md §15.2); the desktop demo reads only it (§17), because
// deets.solutions is not in the app's CSP. The two vite configs share this plugin.

import type { Plugin } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FEED_FILE = fileURLToPath(new URL("../DeetsSolutions/sotd/songs.json", import.meta.url));
const OWNER = "Deets";
const KEEP = ["posted_at", "date", "track_name", "artist_name", "album", "genre", "duration_sec", "release_date", "release_year", "apple_music_url", "preview_url", "artwork_url"];
const PICKS_ID = "virtual:sotd-picks";

export function sotdPicks(): Plugin {
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
