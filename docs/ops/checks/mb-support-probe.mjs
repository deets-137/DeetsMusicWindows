// MusicBrainz coverage probe for the Support link (docs/ideas/SupportArtist.md §5).
// Reads the library from the app's SQLite file READ-ONLY, asks MusicBrainz (1 call/s) and
// Wikidata (a few SPARQL calls), and writes results to <out dir>. Resumable: the cache file
// keeps every answer, so a second run only asks what is missing.
//
//   node docs/ops/checks/mb-support-probe.mjs <out dir> [--db <path>] [--no-names]
// <out dir> goes in a scratchpad, never the repo. The first run takes ~40 min (the name
// search is 1 call/s); a second run from the same <out dir> reuses the cache.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outDir = args[0];
if (!outDir) { console.error('usage: node mb-support-probe.mjs <out dir> [--db <path>] [--no-names]'); process.exit(2); }
const dbPath = args.includes('--db') ? args[args.indexOf('--db') + 1]
  : path.join(process.env.APPDATA, 'com.deetsmusic.app', 'deetsmusic.db');
const doNames = !args.includes('--no-names');
fs.mkdirSync(outDir, { recursive: true });

const UA = 'DeetsMusic-probe/0.1 ( https://github.com/deets-137/DeetsMusicWindows )';
const MB = 'https://musicbrainz.org/ws/2';
// Storefronts tried for the Apple artist URL. MB stores music.apple.com/<cc>/artist/<id>.
const CC = ['us', 'gb', 'ca', 'au', 'nz', 'ie', 'de', 'fr', 'nl', 'be', 'se', 'no', 'dk', 'fi',
  'es', 'it', 'pt', 'at', 'ch', 'pl', 'jp', 'kr', 'in', 'br', 'mx', 'ar', 'cl', 'za', 'ng', 'ph',
  'sg', 'id', 'tr', 'ru', 'ua'];
const SUPPORT = ['crowdfunding', 'patronage', 'bandcamp', 'official homepage'];

// ── cache ──────────────────────────────────────────────────────────────────────
const cacheFile = path.join(outDir, 'cache.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  : { urlHits: {}, urlDone: [], artist: {}, search: {}, wikidata: null };
const save = () => fs.writeFileSync(cacheFile, JSON.stringify(cache));

// ── 1 call per second, retry on 503 ────────────────────────────────────────────
let last = 0;
async function mb(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (res.status === 503 || res.status === 429) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`gave up: ${url}`);
}

// ── the library ────────────────────────────────────────────────────────────────
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare(`
  with t as (
    select json_extract(json,'$.artistName') name, json_extract(json,'$.albumName') album,
           json_extract(json,'$.catalogId') cid
    from tracks where source = 'library')
  select t.name, count(*) songs,
         sum(coalesce(p.partial_count,0) + coalesce(p.full_count,0)) plays,
         group_concat(distinct t.album) albums, c.catalog_id apple_id
  from t left join play_stats p on p.track_id = t.cid
         left join artist_catalog c on c.name = t.name
  where t.name is not null
  group by t.name`).all().map(r => ({ ...r, albums: (r.albums || '').split(',') }));
db.close();
rows.sort((a, b) => b.plays - a.plays || b.songs - a.songs);
rows.forEach((r, i) => { r.rank = i + 1; });
const COLLAB = /\s(&|x|X|and|feat\.?|ft\.?|with)\s|,\s/;
console.log(`library: ${rows.length} artist names, ${rows.filter(r => r.apple_id).length} with an Apple id`);

// ── path 1: Apple URL, batched 100 resources per call ──────────────────────────
const ids = [...new Set(rows.filter(r => r.apple_id).map(r => r.apple_id))];
const done = new Set(cache.urlDone);
const todo = [];
for (const id of ids) for (const cc of CC) {
  const u = `https://music.apple.com/${cc}/artist/${id}`;
  if (!done.has(u)) todo.push(u);
}
console.log(`path 1: ${todo.length} URLs to ask, ${Math.ceil(todo.length / 100)} calls`);
for (let i = 0; i < todo.length; i += 100) {
  const batch = todo.slice(i, i + 100);
  const qs = batch.map(u => 'resource=' + encodeURIComponent(u)).join('&');
  const j = await mb(`${MB}/url?${qs}&inc=artist-rels&fmt=json`);
  for (const u of (j?.urls || [])) {
    const artists = [...new Set((u.relations || []).filter(r => r.artist).map(r => r.artist.id))];
    if (artists.length) cache.urlHits[u.resource] = artists;
  }
  for (const u of batch) done.add(u);
  cache.urlDone = [...done];
  if ((i / 100) % 10 === 0) { save(); process.stdout.write(`  ${i + batch.length}/${todo.length}\r`); }
}
save();
const byApple = {};
for (const [u, mbids] of Object.entries(cache.urlHits)) {
  const m = u.match(/music\.apple\.com\/(\w+)\/artist\/(\d+)/);
  if (!m) continue;
  (byApple[m[2]] ||= { mbids: new Set(), cc: new Set() });
  mbids.forEach(x => byApple[m[2]].mbids.add(x));
  byApple[m[2]].cc.add(m[1]);
}

// ── artist lookup: url rels + release groups ───────────────────────────────────
async function artist(mbid) {
  if (cache.artist[mbid]) return cache.artist[mbid];
  const j = await mb(`${MB}/artist/${mbid}?inc=url-rels+release-groups&fmt=json`);
  const a = j ? {
    name: j.name,
    rels: (j.relations || []).filter(r => r.url).map(r => [r.type, r.url.resource, !!r.ended]),
    rgs: (j['release-groups'] || []).map(g => g.title),
  } : { name: null, rels: [], rgs: [] };
  cache.artist[mbid] = a; save();
  return a;
}

const norm = s => (s || '').toLowerCase()
  .replace(/\s*[-–]\s*(single|ep)$/i, '').replace(/\s*\((deluxe|expanded|remaster|bonus)[^)]*\)/gi, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

let n = 0;
for (const r of rows) {
  const hit = r.apple_id && byApple[r.apple_id];
  if (hit) {
    r.path = 1; r.cc = [...hit.cc]; r.mbids = [...hit.mbids];
    r.mb = [];
    for (const id of r.mbids) r.mb.push(await artist(id));
    if (++n % 25 === 0) process.stdout.write(`  lookups ${n}\r`);
  }
}
console.log(`path 1 matched ${rows.filter(r => r.path === 1).length}`);

// ── path 2: name search + one album title ─────────────────────────────────────
if (doNames) {
  const miss = rows.filter(r => !r.path);
  console.log(`path 2: ${miss.length} names`);
  let k = 0;
  for (const r of miss) {
    let s = cache.search[r.name];
    if (!s) {
      const j = await mb(`${MB}/artist?query=${encodeURIComponent('artist:"' + r.name.replace(/"/g, '') + '"')}&limit=3&fmt=json`);
      s = (j?.artists || []).map(a => ({ id: a.id, name: a.name, score: a.score }));
      cache.search[r.name] = s; save();
    }
    r.top = s[0] || null;
    if (r.top && r.top.score >= 90) {
      const a = await artist(r.top.id);
      const lib = new Set(r.albums.map(norm));
      r.albumMatch = a.rgs.some(t => lib.has(norm(t)));
      if (r.albumMatch) { r.path = 2; r.mbids = [r.top.id]; r.mb = [a]; }
    }
    if (++k % 25 === 0) process.stdout.write(`  names ${k}/${miss.length}\r`);
  }
}

// ── Wikidata: Apple id P2850 → Bandcamp P3283, Patreon P4175, site P856 ───────
if (!cache.wikidata) {
  cache.wikidata = {};
  for (let i = 0; i < ids.length; i += 200) {
    const vals = ids.slice(i, i + 200).map(x => `"${x}"`).join(' ');
    const q = `SELECT ?apple ?bc ?pat ?site WHERE { VALUES ?apple { ${vals} } ?item wdt:P2850 ?apple .
      OPTIONAL { ?item wdt:P3283 ?bc } OPTIONAL { ?item wdt:P4175 ?pat } OPTIONAL { ?item wdt:P856 ?site } }`;
    const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q),
      { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
    if (!res.ok) { console.error('wikidata', res.status); break; }
    for (const b of (await res.json()).results.bindings) {
      const w = (cache.wikidata[b.apple.value] ||= { bc: null, pat: null, site: null });
      if (b.bc) w.bc = b.bc.value; if (b.pat) w.pat = b.pat.value; if (b.site) w.site = b.site.value;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  save();
}

// ── classify ──────────────────────────────────────────────────────────────────
for (const r of rows) {
  const rels = (r.mb || []).flatMap(a => a.rels).filter(([, , ended]) => !ended);
  const has = t => rels.some(([type]) => type === t);
  r.fund = has('crowdfunding') || has('patronage');
  r.bandcamp = has('bandcamp');
  r.site = has('official homepage');
  r.links = Object.fromEntries(SUPPORT.map(t => [t, rels.filter(([x]) => x === t).map(([, u]) => u)]).filter(([, v]) => v.length));
  r.ambiguous = (r.mbids || []).length > 1;
  r.collab = COLLAB.test(r.name);
  const w = r.apple_id && cache.wikidata[r.apple_id];
  r.wd = !!w; r.wdBandcamp = !!(w && w.bc); r.wdPatreon = !!(w && w.pat); r.wdSite = !!(w && w.site);
}

function stats(set) {
  const c = f => set.filter(f).length;
  const pct = x => set.length ? `${x} (${Math.round(100 * x / set.length)} %)` : '0';
  return {
    artists: set.length,
    'with Apple id': pct(c(r => r.apple_id)),
    'collab names': pct(c(r => r.collab)),
    'matched path 1 (Apple URL)': pct(c(r => r.path === 1)),
    '  of those, >1 MB artist': c(r => r.path === 1 && r.ambiguous),
    'matched path 2 (name + album)': pct(c(r => r.path === 2)),
    'path 2 name hit, no album match': c(r => !r.path && r.top && r.top.score >= 90),
    unmatched: pct(c(r => !r.path)),
    'any Support link': pct(c(r => r.fund || r.bandcamp || r.site)),
    'crowdfunding or Patreon': pct(c(r => r.fund)),
    Bandcamp: pct(c(r => r.bandcamp)),
    'official site only': pct(c(r => r.site && !r.fund && !r.bandcamp)),
    'matched, nothing': pct(c(r => r.path && !r.fund && !r.bandcamp && !r.site)),
    'Wikidata knows the Apple id': pct(c(r => r.wd)),
    'Wikidata Bandcamp': pct(c(r => r.wdBandcamp)),
    'Bandcamp from Wikidata only': c(r => r.wdBandcamp && !r.bandcamp),
    'Patreon from Wikidata only': c(r => r.wdPatreon && !r.fund),
    'any Support (MB + Wikidata)': pct(c(r => r.fund || r.bandcamp || r.site || r.wdBandcamp || r.wdPatreon || r.wdSite)),
  };
}
const ccCount = {};
rows.filter(r => r.path === 1).forEach(r => r.cc.forEach(cc => { ccCount[cc] = (ccCount[cc] || 0) + 1; }));
const report = {
  run: new Date().toISOString(),
  all: stats(rows),
  top50: stats(rows.slice(0, 50)),
  top200: stats(rows.slice(0, 200)),
  tail: stats(rows.slice(200)),
  storefronts: Object.fromEntries(Object.entries(ccCount).sort((a, b) => b[1] - a[1])),
};
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, 'artists.json'), JSON.stringify(rows.map(r => ({
  rank: r.rank, name: r.name, plays: r.plays, songs: r.songs, apple_id: r.apple_id, path: r.path || 0,
  cc: r.cc, mbids: r.mbids, top: r.top, links: r.links, wd: r.apple_id ? cache.wikidata[r.apple_id] : undefined,
})), null, 1));
console.log(JSON.stringify(report, null, 2));
