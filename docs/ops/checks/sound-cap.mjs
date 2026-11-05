// The cap until measured (docs/features/SOUND.md § 11a-2), on the dev app: the wiring, not the ear
// test. Needs `npm run dev:app`. IT PLAYS MUSIC at 1.5 % volume: the meter skips hops under 1 %, so
// the app's volume cannot be 0 here. It puts the volume, the settings and the queue back, and ends paused.
// Pass: every line of the report says ok. Argument: a catalog search for an album with unmeasured songs.
import { execFileSync } from "node:child_process";

const TERM = process.argv[2] ?? "Bon Iver For Emma";

const drive = String.raw`window.__capRun = (async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const addr = async (importer, re) => (await (await fetch(importer)).text()).match(re)[1];
  const player = await import(await addr("/src/playlists-card.ts", /"(\/src\/player\.ts[^"]*)"/));
  const queue = await import(await addr("/src/collection-card.ts", /"(\/src\/queue\.ts[^"]*)"/));
  const store = await import(await addr("/src/playlists-card.ts", /"(\/src\/settings-store\.ts[^"]*)"/));
  const search = await import(await addr("/src/compass.ts", /"(\/src\/search\.ts[^"]*)"/));
  const out = [];
  const say = (name, ok, more) => { window.__capStep = name; out.push((ok ? "ok    " : "FAIL  ") + name + (more === undefined ? "" : "  " + JSON.stringify(more))); };
  const st = () => window.__cap.state();
  const gain = () => window.__sound.get ? st().source?.gainDb : undefined;

  const before = { volume: player.getVolume(), match: store.setting("soundMatch"), album: store.setting("soundLoudAlbum"), queue: queue.snapshot() };
  try {
    player.setVolume(0.015);
    store.setSetting("soundMatch", true, "app");
    store.setSetting("soundLoudAlbum", true, "app");
    await window.__cap.mode("until");
    await wait(300);

    const hits = await search.searchCatalog(${JSON.stringify(TERM)}, ["albums"]);
    const album = (hits.albums ?? [])[0];
    if (!album) throw new Error("no album for the search");
    const id = album.catalogId ?? album.id;
    const songs = await search.collectionTracks("albums", id);
    const ctx = "search-albums:" + id;
    say("album found", songs.length > 2, { title: album.title, songs: songs.length });

    await player.playTracks(songs, 0, ctx);
    await wait(6000);
    let s = st();
    const startKind = s.source?.kind;
    say("first song of a Search album is capped, or takes the rows' gain", startKind === "capped" || startKind === "album", s.source);
    say("the run is open on the Search context", s.run?.context === ctx, s.run);
    if (startKind === "capped") {
      say("the cap hears hops", s.cap.heardS >= 3, s.cap);
      await wait(19000);
      s = st();
      say("past the settle time it has an estimate", s.cap.heardS >= 20 && s.cap.estimateLufs !== null, s.cap);
    }

    const g0 = gain();
    await player.playPause("test");
    await wait(2500);
    say("a pause holds the gain", gain() === g0, { g0, now: gain() });
    await player.playPause("test");
    await wait(1500);

    const end = gain();
    await player.nextTrack("test");
    await wait(4000);
    s = st();
    say("song 2 takes the album's gain", s.source?.kind === "album", s.source);
    say("the album's size came from the queue", s.source?.total === songs.length, { total: s.source?.total, songs: songs.length });
    say("the gain moved by at most one step", Math.abs(s.source.gainDb - end) <= 1.5 + 1e-6, { end, now: s.source.gainDb });
    say("no cap during an album in order", !s.cap);
    const g2 = s.source.gainDb;
    await wait(4000);
    say("the gain holds during song 2", st().source?.gainDb === g2, st().source);

    await player.playTracks([songs[2]], 0, "library");
    await wait(4000);
    s = st();
    say("a play outside the album ends the run", s.run === null, s.run);
    say("a lone song is capped or takes its row", s.source?.kind === "capped" || s.source?.kind === "song", s.source);

    await window.__cap.mode("off");
    s = st();
    say("mode off drops the cap", !s.cap && s.source?.kind !== "capped", s.source);
    await window.__cap.mode("always");
    say("mode always caps the song", st().source?.kind === "capped", st().source);
  } catch (e) {
    say("the run stopped", false, String(e));
  } finally {
    await window.__cap.mode("until");
    if (player.isPlayingNow()) await player.playPause("test");
    await wait(300);
    queue.restore(before.queue, true);
    store.setSetting("soundMatch", before.match, "app");
    store.setSetting("soundLoudAlbum", before.album, "app");
    player.setVolume(before.volume);
    say("put back", store.setting("soundMatch") === before.match && player.getVolume() === before.volume, { match: before.match, volume: before.volume });
  }
  return out;
})().then((r) => (window.__capOut = r), (e) => (window.__capOut = ["FAIL  " + e.message]));
1`;

const eval_ = (js) => execFileSync("node", ["scripts/webview-eval.mjs", js], { encoding: "utf8", maxBuffer: 1 << 24 }).trim();
// webview-eval gives up after 20 s, so the run starts in the page and the answer is read after it.
eval_("delete window.__capOut, 1");
eval_(drive);
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const lines = JSON.parse(eval_("JSON.stringify(window.__capOut ?? null)"));
  if (lines) {
    console.log(lines.join("\n"));
    process.exit(0);
  }
}
console.log("FAIL  no answer in 90 s, last step: " + eval_("String(window.__capStep)"));
