// Song changes around uploaded songs, on the running dev app (UPLOADS.md §6).
// Needs the test album "Upload Test Vol. 1" in the dev library, and two catalog songs from
// PRESS PLAY. Plays sound. Each case starts a list through the page's own playTracks, lets the
// songs end, and prints every song change, the player's warnings and the model against MusicKit.
//
//   node docs/ops/checks/upload-next.mjs [case ...]    (default: every case)
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const UP = "Upload Test Vol. 1";
const CAT = "PRESS PLAY";

const CASES = {
  "catalog-upload-catalog": { list: [[CAT, "Sweat"], [UP, "Uncle Ringtone"], [CAT, "Tarantino"]], seek: true, secs: 28, want: "Tarantino" },
  "next-during-wait": { list: [[UP, "Uncle Ringtone"], [UP, "Legume Jazz Bar"], [UP, "Hold Music"]], pressNext: true, secs: 10, want: "Hold Music" },
  "match-loudness": { list: [[UP, "Legume Jazz Bar"], [UP, "Uncle Ringtone"], [UP, "Legume Sauna"]], match: true, secs: 14, want: "Legume Sauna" },
};

const page = (js) => execFileSync("node", ["scripts/webview-eval.mjs", js], { cwd: root, encoding: "utf8", timeout: 60000 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// webview-eval waits 20 s at most, so a case runs in the page and is polled for its answer.
const run = async (c) => {
  page(`window.__uploadNext=null;(async()=>{
  const c=${JSON.stringify(c)};
  const src=await (await fetch("/src/history-card.ts")).text();
  const player=await import(src.match(/"(\\/src\\/player\\.ts[^"]*)"/)[1]);
  const inv=window.__TAURI_INTERNALS__.invoke;
  let all=[];for(let o=0;o<6000;o+=1000){const p=await inv("library_tracks",{offset:o,limit:1000});all=all.concat(p.items);if(p.items.length<1000)break;}
  const pick=(a,t)=>all.find(x=>x.albumName===a&&x.title===t);
  const list=c.list.map(e=>pick(e[0],e[1]));
  const before=JSON.stringify(window.__sound.get());
  if(c.match)window.__sound.set({match:true,measure:true});
  const m=MusicKit.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const warns=[];const w0=console.warn;console.warn=(...a)=>{warns.push(String(a[0]).slice(0,80));w0(...a)};
  await player.playTracks(list,0,"library");
  let pressed=false;
  const onS=()=>{if(c.pressNext&&!pressed&&m.playbackState===5&&!m.nowPlayingItem){pressed=true;void player.nextTrack();}};
  m.addEventListener("playbackStateDidChange",onS);
  if(c.seek){await wait(3000);await m.seekToTime(m.currentPlaybackDuration-1.5);}
  const line=()=>(m.nowPlayingItem?m.nowPlayingItem.title:"-")+" | "+m.playbackState;
  const seq=[];let last="";const t0=performance.now();
  while(performance.now()-t0<c.secs*1000){const l=line();if(l!==last){seq.push(((performance.now()-t0)/1000).toFixed(1)+"s "+l);last=l;}await wait(100);}
  m.removeEventListener("playbackStateDidChange",onS);console.warn=w0;
  const q=window.__player.queue();
  const out={now:m.nowPlayingItem&&m.nowPlayingItem.title,model:q.nowPlaying.model&&q.nowPlaying.model.title,aligned:q.aligned.aligned,playing:m.isPlaying,pressed,seq,warns};
  window.__sound.set(JSON.parse(before));
  return out;
})().then(r=>{window.__uploadNext=r},e=>{window.__uploadNext={error:String(e)}});1`);
  for (let i = 0; i < c.secs + 25; i++) {
    await pause(1000);
    const r = JSON.parse(page("window.__uploadNext"));
    if (r) return r;
  }
  return { error: "no answer" };
};

const names = process.argv.slice(2);
let bad = 0;
for (const name of names.length ? names : Object.keys(CASES)) {
  const c = CASES[name];
  const r = await run(c);
  if (r.error) {
    bad++;
    console.log(`FAIL ${name}: ${r.error}`);
    continue;
  }
  const ok = r.now === c.want && r.model === c.want && r.aligned && r.playing;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: now "${r.now}", model "${r.model}", aligned ${r.aligned}, playing ${r.playing}`);
  console.log(`     ${r.seq.join("  ·  ")}`);
  if (r.warns.length) console.log(`     warnings: ${r.warns.join(" / ")}`);
}
process.exitCode = bad ? 1 : 0;
