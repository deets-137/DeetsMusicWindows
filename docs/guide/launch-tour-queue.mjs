// Loads the launch tour's songs (launch-tour-songs.json, in order; a song with no id is skipped)
// into the DEV app's queue through its own bridge (/tracks, then /play), so the model and
// MusicKit agree (a script import of player.ts left MusicKit on the old queue and every Next was
// abandoned, 2026-10-21). Usage: node docs/guide/launch-tour-queue.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ids = JSON.parse(readFileSync(join(here, "launch-tour-songs.json"), "utf8")).songs.filter((s) => s.id).map((s) => s.id);
const token = JSON.parse(readFileSync(join(process.env.APPDATA, "com.deetsmusic.dev", "settings.json"), "utf8")).bridgeToken;
const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

// The dev app's bridge: the port that takes the dev token (the installed app may hold 47825).
let port = 0;
for (const p of [47825, 47826, 47827, 47828]) {
  try {
    const r = await fetch(`http://127.0.0.1:${p}/tracks`, { method: "POST", headers: h, body: JSON.stringify({ id: `song:${ids[0]}` }), signal: AbortSignal.timeout(4000) });
    if (r.ok) { port = p; break; }
  } catch {}
}
if (!port) throw new Error("no bridge takes the dev token: is the dev app up?");
const post = async (route, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${route} ${r.status} ${await r.text()}`);
  return r.json();
};
const tracks = [];
for (const id of ids) tracks.push(...(await post("/tracks", { id: `song:${id}` })).tracks);
const res = await post("/play", { tracks });
console.log(`port ${port}:`, res.ok, tracks.map((t) => `${t.title} (${t.albumName})`).join(" | "));
