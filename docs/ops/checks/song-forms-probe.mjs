// The song name form (docs/features/LISTENERS.md §9.4 step 1). For his most-played songs whose Apple
// names differ from the plain form (the main artist, the title with no "(feat. …)"): track.getInfo
// under each form. It prints how often the plain page is more than 10× larger, and how often it is
// smaller. Reads the installed app's database, read-only. No app needed. One call each 220 ms.
//
//   node docs/ops/checks/song-forms-probe.mjs [songs]
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const LIMIT = Number(process.argv[2] ?? 120);
const keyFile = process.env.DEETSMUSIC_LASTFM || path.join(process.env.USERPROFILE, "Documents", "Deets' Secrets", "lastfm.json");
const KEY = JSON.parse(fs.readFileSync(keyFile, "utf8")).apiKey;
const API = `https://ws.audioscrobbler.com/2.0/?format=json&api_key=${KEY}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const count = async (artist, title) => {
  const q = `method=track.getInfo&autocorrect=1&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}`;
  const j = await (await fetch(`${API}&${q}`, { headers: { "User-Agent": "DeetsMusic-probe/0.1" } })).json();
  await wait(220);
  return j.track ? Number(j.track.playcount) : -1;
};

// The first rule of src/lastfm-names.ts `songForms` (2026-11-05, before the edition words).
const MORE = /\s*,\s+|\s+(?:&|x|×|feat\.?|ft\.?|featuring)\s+/i;
const FEAT = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]|\s*\[Explicit\]/gi;
const plain = (a, t) => [a.split(MORE)[0].trim() || a, t.replace(FEAT, "").trim() || t];

const db = new DatabaseSync(path.join(process.env.APPDATA, "com.deetsmusic.app", "deetsmusic.db"), { readOnly: true });
const rows = db
  .prepare("SELECT t.json FROM play_stats p JOIN tracks t ON t.track_id = p.track_id ORDER BY p.full_count + p.partial_count DESC LIMIT 3000")
  .all()
  .map((r) => JSON.parse(r.json));
const seen = new Set();
const songs = [];
for (const t of rows) {
  if (!t.artistName || !t.title) continue;
  const [a, b] = plain(t.artistName, t.title);
  const key = `${t.artistName}|${t.title}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (a !== t.artistName || b !== t.title) songs.push({ artist: t.artistName, title: t.title, a, b });
}
const of = rows.length;
const list = songs.slice(0, LIMIT);
let big = 0, more = 0, same = 0, less = 0, lost = 0, found = 0;
for (const s of list) {
  const apple = await count(s.artist, s.title);
  const easy = await count(s.a, s.b);
  const n = (v) => (v < 0 ? "none" : String(v));
  if (easy < 0) lost++;
  else if (apple < 0) found++;
  else if (easy > apple * 10) big++;
  else if (easy > apple) more++;
  else if (easy === apple) same++;
  else less++;
  if (easy < 0 || apple < 0 || easy > apple * 10 || easy < apple) console.log(`${s.artist} / ${s.title}: ${n(apple)} → ${s.a} / ${s.b}: ${n(easy)}`);
}
console.log(`\n${songs.length} of ${of} played songs differ; asked ${list.length}.`);
console.log(`plain over 10× larger ${big} · larger ${more} · the same ${same} · smaller ${less} · only plain found ${found} · plain not found ${lost}`);
