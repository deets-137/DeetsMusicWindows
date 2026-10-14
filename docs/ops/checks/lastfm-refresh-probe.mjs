// Last.fm refresh probe (docs/features/PresentationMode.md §7 step 1).
// Reads the top 3 songs of chart.getTopTracks and a set of albums every <interval> seconds for
// <minutes>, and prints a line each time a count moves. It answers how often Last.fm refreshes
// the public Plays / Listeners counts: the label under a presented number ("updated N min ago").
//
//   node docs/ops/checks/lastfm-refresh-probe.mjs <out dir> [--minutes 60] [--interval 60]
// <out dir> goes in a scratchpad, never the repo. The key is read from the same file build.rs
// reads (Documents\Deets' Secrets\lastfm.json, or DEETSMUSIC_LASTFM). 2 + albums calls a read:
// far under Last.fm's ~5 calls a second.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outDir = args[0];
if (!outDir) { console.error('usage: node lastfm-refresh-probe.mjs <out dir> [--minutes 60] [--interval 60]'); process.exit(2); }
const opt = (name, dflt) => args.includes(name) ? Number(args[args.indexOf(name) + 1]) : dflt;
const minutes = opt('--minutes', 60);
const interval = opt('--interval', 60);
fs.mkdirSync(outDir, { recursive: true });

const keyFile = process.env.DEETSMUSIC_LASTFM
  || path.join(process.env.USERPROFILE, 'Documents', "Deets' Secrets", 'lastfm.json');
const KEY = JSON.parse(fs.readFileSync(keyFile, 'utf8')).apiKey;
const API = `https://ws.audioscrobbler.com/2.0/?format=json&api_key=${KEY}`;
const ALBUMS = [
  ['Matilda Mann', 'Inventing'],      // a mid-size album (~49K listeners)
  ['Lucy Park', 'THREAD 27'],         // a small EP (~600 listeners)
];

const get = async (q) => (await fetch(`${API}&${q}`, { headers: { 'User-Agent': 'DeetsMusic-probe/0.1' } })).json();

async function read() {
  const out = {};
  const chart = await get('method=chart.getTopTracks&limit=3');
  for (const t of chart.tracks?.track ?? []) {
    out[`song: ${t.artist.name} / ${t.name}`] = [Number(t.playcount), Number(t.listeners)];
  }
  for (const [artist, album] of ALBUMS) {
    const a = (await get(`method=album.getInfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`)).album;
    if (a) out[`album: ${artist} / ${album}`] = [Number(a.playcount), Number(a.listeners)];
  }
  return out;
}

const log = fs.createWriteStream(path.join(outDir, 'reads.jsonl'), { flags: 'a' });
const changes = fs.createWriteStream(path.join(outDir, 'changes.txt'), { flags: 'a' });
const say = (line) => { console.log(line); changes.write(line + '\n'); };
const last = {};
const lastMove = {};
const start = Date.now();
say(`start ${new Date().toISOString()} · ${minutes} min · every ${interval} s`);

while (Date.now() - start < minutes * 60_000) {
  const at = new Date();
  try {
    const now = await read();
    log.write(JSON.stringify({ at: at.toISOString(), now }) + '\n');
    for (const [k, [plays, listeners]] of Object.entries(now)) {
      const prev = last[k];
      if (prev && (prev[0] !== plays || prev[1] !== listeners)) {
        const since = lastMove[k] ? `${Math.round((at - lastMove[k]) / 60_000)} min after the last move` : 'first move seen';
        say(`${at.toISOString()} ${k}: plays +${plays - prev[0]}, listeners +${listeners - prev[1]} (${since})`);
        lastMove[k] = at;
      }
      last[k] = [plays, listeners];
    }
  } catch (e) {
    say(`${at.toISOString()} read failed: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, interval * 1000));
}
say(`end ${new Date().toISOString()}`);
for (const [k, [p, l]] of Object.entries(last)) say(`final ${k}: ${p} plays, ${l} listeners`);
log.end(); changes.end();
