// The rooms port's build (docs/features/WebRooms.md §9.3 B): the app's Search, Queue, History and
// Now Playing cards in a browser, joined to a DeetsMusicRooms room, for deets.solutions/radio.
// Like the web demo (vite.demo.config.ts), it serves the REAL index.html with a few changes made
// as it is served, so the look's pre-paint script and the MusicKit alert guard stay one copy:
//   - `web/listen.ts` takes main.ts's place (it installs the Tauri stand-in, then the cards);
//   - the Radio tab's developer token loads before it (his call W4);
//   - the title bar becomes the port's: its name and the Room item, nothing else;
//   - the window is Max with two cards beside the stage (Search, History), no launch cover.
// MusicKit's own script from Apple's CDN is KEPT: this build plays real songs.
// `--mode listen` sets `import.meta.env.MODE`, which `src/platform.ts` reads as WEB_ROOMS.
//
//   npm run listen         a dev server on 8787 or 8788 (see below)
//   npm run listen:build   dist-listen/ — what deets.solutions/radio/app/ serves

import { defineConfig, type Plugin } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

// The developer token lives in the site repo beside this one, re-signed there by a nightly job
// (../DeetsSolutions/docs/radio.md "The developer token"). The dev server serves that file at
// the path the live page uses; the built page asks the site for it, so it is never copied here.
const TOKEN_FILE = fileURLToPath(new URL("../DeetsSolutions/radio/dev-token.js", import.meta.url));
const TOKEN_PATH = "/radio/dev-token.js";

// The token's `origin` claim allows deets.solutions and localhost:8787 / 8788 only, and Apple
// checks it on every call. So the dev server takes the first FREE one of those two (several
// Deets apps run on this PC at once), and says so when both are taken, rather than starting
// on a port where every Apple call fails.
const TOKEN_PORTS = [8787, 8788];
function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const s = createServer();
    s.once("error", () => done(false));
    s.once("listening", () => s.close(() => done(true)));
    s.listen(port, "localhost");
  });
}
async function pickPort(): Promise<number> {
  if (process.env.VITE_PORT) return Number(process.env.VITE_PORT);
  for (const p of TOKEN_PORTS) if (await portFree(p)) return p;
  throw new Error(`[listen] ports ${TOKEN_PORTS.join(" and ")} are both taken; the Apple token allows only these on localhost`);
}

const TITLEBAR = `<header class="titlebar listen__bar">
      <div class="settings"><span class="app-title"><span class="app-title__full">DeetsMusic Rooms</span><span class="app-title__short" aria-hidden="true">DM</span></span></div>
      <div class="drag-region"></div>
      <div class="chrome-right">
        <div class="room" id="room">
          <button class="room__btn" id="room-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Listening room" title="Start a room, or join one with a code"></button>
          <div class="room__panel pop app-scroll" id="room-panel" role="group" aria-label="Listening room" hidden></div>
        </div>
      </div>
    </header>`;

function listenPage(): Plugin {
  return {
    name: "deets-listen-page",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const main = /<script type="module" src="\/src\/main\.ts"[^>]*><\/script>/;
        const header = /<header class="titlebar"[\s\S]*?<\/header>/;
        const cover = /\s*<div class="boot-cover"[^>]*><\/div>/;
        const root = /<html lang="en"([^>]*)>/;
        for (const [name, re] of Object.entries({ main, header, cover, root })) {
          if (!re.test(html)) throw new Error(`[listen] index.html changed (${name}): update vite.listen.config.ts`);
        }
        return html
          .replace(root, (_, attrs: string) => `<html lang="en"${attrs.replace(/\s*data-boot="[^"]*"/, "").replace(/data-surface="[^"]*"/, 'data-surface="max"')} data-web="rooms">`)
          // After the pre-paint script, which writes the saved Max layout: the port is always two cards.
          .replace("<title>DeetsMusic</title>", `<title>DeetsMusic Rooms</title>\n    <script>document.documentElement.setAttribute("data-max-cards", "2cols");</script>`)
          .replace(cover, "")
          .replace(header, TITLEBAR)
          .replace(main, `<script src="${TOKEN_PATH}"></script>\n    <script type="module" src="/web/listen.ts"></script>`);
      },
    },
    configureServer(server) {
      server.middlewares.use(TOKEN_PATH, (_req, res) => {
        if (!existsSync(TOKEN_FILE)) {
          res.statusCode = 404;
          return void res.end(`// no token at ${TOKEN_FILE}: is ../DeetsSolutions checked out?`);
        }
        res.setHeader("Content-Type", "text/javascript");
        res.end(readFileSync(TOKEN_FILE));
      });
    },
  };
}

export default defineConfig(async ({ command }) => ({
  base: "./",
  plugins: [listenPage()],
  esbuild: { target: "es2022" },
  build: {
    target: "es2022",
    outDir: "dist-listen",
    emptyOutDir: true,
    rollupOptions: { input: { main: "index.html" } },
  },
  clearScreen: false,
  server: {
    port: command === "serve" ? await pickPort() : undefined,
    strictPort: true, // the port was picked free above; any other port fails every Apple call
    watch: { ignored: ["**/src-tauri/**", "**/cli/target/**", "**/dist-web/**", "**/dist-listen/**"] },
  },
}));
