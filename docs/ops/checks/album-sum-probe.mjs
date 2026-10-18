// Album sum probe (docs/features/LISTENERS.md §9.1).
// For each album in ALBUMS: album.getInfo's plays and listeners, then one track.getInfo per song
// of Last.fm's own track list, the sum of the song plays, and the top song's listeners. It shows
// how far the album page is from its songs, and which song names land on a tiny page.
//
//   node docs/ops/checks/album-sum-probe.mjs
// No app needed. The key is read from the same file build.rs reads (Documents\Deets'
// Secrets\lastfm.json, or DEETSMUSIC_LASTFM). One call each 220 ms: under Last.fm's ~5 a second.
import fs from 'node:fs';
import path from 'node:path';
const keyFile = process.env.DEETSMUSIC_LASTFM
  || path.join(process.env.USERPROFILE, 'Documents', "Deets' Secrets", 'lastfm.json');
const KEY = JSON.parse(fs.readFileSync(keyFile, 'utf8')).apiKey;
const API = `https://ws.audioscrobbler.com/2.0/?format=json&api_key=${KEY}`;
const get = async (q) => (await fetch(`${API}&${q}`, { headers: { 'User-Agent': 'DeetsMusic-probe/0.1' } })).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ALBUMS = [
  ['Matilda Mann', 'Inventing'],
  ['Lucy Park', 'THREAD 27'],
  ['Blood Orange', 'Essex Honey'],
  ['SZA', 'SOS'],
];
for (const [artist, album] of ALBUMS) {
  const t0 = Date.now();
  const a = (await get(`method=album.getInfo&autocorrect=1&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`)).album;
  if (!a) { console.log(artist, album, 'not found'); continue; }
  let tracks = a.tracks?.track ?? [];
  if (!Array.isArray(tracks)) tracks = [tracks];
  let plays = 0, maxL = 0, sumL = 0, none = 0;
  const rows = [];
  for (const t of tracks) {
    await wait(220);
    const r = (await get(`method=track.getInfo&autocorrect=1&artist=${encodeURIComponent(t.artist?.name ?? artist)}&track=${encodeURIComponent(t.name)}`)).track;
    if (!r) { none++; rows.push(`  ${t.name}: none`); continue; }
    const p = Number(r.playcount), l = Number(r.listeners);
    plays += p; sumL += l; maxL = Math.max(maxL, l);
    rows.push(`  ${t.name}: ${p} plays, ${l} listeners`);
  }
  console.log(`${artist} / ${album}: album ${a.playcount} plays, ${a.listeners} listeners; ${tracks.length} songs`);
  console.log(`  sum of songs ${plays} plays (x${(plays / a.playcount).toFixed(2)}); listeners max ${maxL}, sum ${sumL}; none ${none}; ${Date.now() - t0} ms`);
  console.log(rows.join('\n'));
}
