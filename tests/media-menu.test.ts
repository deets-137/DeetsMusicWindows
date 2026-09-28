// media-menu.ts: one right-click menu per media type, the rows in the CONTEXT-MENUS.md §2
// order, the card's own rows in group 6 and the take-away rows last (2026-09-23; the Friends
// box joined 2026-09-27). The row modules are stubbed (tests/stubs/menu-deps.ts): the test is
// about the ORDER media-menu.ts builds, not about what a row does when pressed.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Every heavy import of media-menu.ts goes to the stub map. `./queue`, `./row-pick` and
// `./settings-store` are pure and load for real, as their own tests show.
const STUBBED = /^\.\/(search|track-store|player|playlists|layout-bus|go-to|artist-credit|copy-link|start-station|web|library-add|favorites|sotd|pins|rewind)$/;
const stubs = new URL("./stubs/menu-deps.ts", import.meta.url).href; // a file URL already (a Windows path must not go through pathToFileURL twice)
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "@tauri-apps/api/core" || (STUBBED.test(spec) && ctx.parentURL?.endsWith("/src/media-menu.ts"))) return { url: stubs, shortCircuit: true };
    return next(spec, ctx);
  },
});

type Menu = typeof import("../src/media-menu.ts");
let m: Menu;
before(async () => {
  m = await import("../src/media-menu.ts");
});

const labels = (items: { label?: string; input?: { label?: string } }[]) => items.map((i) => i.label ?? `[${i.input?.label ?? "field"}]`);
const song = { catalogId: "c1", title: "Song", artistName: "Artist", albumName: "Album", genres: [], hasLyrics: false };
const SONG = ["Play Now", "Play Next", "Add to Queue", "Add to Playlist", "Go to Artist", "Go to Album", "Song Credits", "Start Station", "Start a Web", "Copy Link", "Add to Library", "Favorite", "Mark as Song of the Day", "Pin"];

test("a song: the §3.1 rows in the §2 order", () => {
  assert.deepEqual(labels(m.songMenu(song, { context: "t" })), SONG);
});

test("a song: the card's own rows come after Pin, the take-away rows last, a lead row first", () => {
  const items = m.songMenu(song, {
    context: "t",
    lead: [{ label: "Mark", run() {} }],
    own: [{ label: "Move to Top", run() {} }],
    away: [{ label: "Remove", run() {} }],
  });
  assert.deepEqual(labels(items), ["Mark", ...SONG, "Move to Top", "Remove"]);
});

test("the song that is playing: no Play group (play: null)", () => {
  assert.deepEqual(labels(m.songMenu(song, { context: "t", play: null })), SONG.slice(3));
});

test("a song still resolving (no track, a catalog id): only the rows that need no track", () => {
  assert.deepEqual(labels(m.songMenu(undefined, { context: "t", catalogId: "c1" })), ["Go to Artist", "Go to Album", "Start Station", "Copy Link"]);
});

test("the Friends box (2026-09-27): the song menu, then the friend's rows, Remove last", () => {
  const items = m.songMenu(song, {
    context: "friend:x",
    catalog: true,
    own: [{ label: "Copy their code", run() {} }, { input: { label: "Rename", placeholder: "", onSubmit() {} } }],
    away: [{ label: "Remove", run() {} }],
  });
  assert.deepEqual(labels(items), [...SONG, "Copy their code", "[Rename]", "Remove"]);
});

test("an unreleased song: Go to Artist alone", () => {
  assert.deepEqual(labels(m.songMenu({ ...song, unreleased: true }, { context: "t" })), ["Go to Artist"]);
});

const album = { title: "Album", artistName: "Artist", known: [song] };
const ALBUM = ["Play Now", "Shuffle", "Play Next", "Add to Queue", "Add to Playlist", "Go to Artist", "Go to Album", "Start a Web", "Copy Link", "Add to Library", "Add to Diary", "Favorite", "Pin"];

test("an album: the §3.2 rows, Shuffle second, no station", () => {
  assert.deepEqual(labels(m.albumMenu(album, { context: "t" })), ALBUM);
});

test("an album's hero (here), inside its artist (inArtist), inside the Diary (inDiary): the row that would go where you are is left out", () => {
  assert.ok(!labels(m.albumMenu(album, { context: "t", here: true })).includes("Go to Album"));
  assert.ok(!labels(m.albumMenu(album, { context: "t", inArtist: true })).includes("Go to Artist"));
  assert.ok(!labels(m.albumMenu(album, { context: "t", inDiary: true })).includes("Add to Diary"));
});

test("a Home New tile (pinKey null): no Pin row", () => {
  assert.ok(!labels(m.albumMenu({ ...album, pinKey: null }, { context: "t" })).includes("Pin"));
});

test("an artist in the library: the §3.3 rows", () => {
  const items = m.artistMenu({ name: "Artist", songs: [song], inLibrary: true }, { context: "t" });
  assert.deepEqual(labels(items), ["Play Now", "Play Next", "Add to Queue", "Add to Playlist", "Go to Artist", "Start Station", "Start a Web", "Copy Link", "Pin"]);
});

test("the artist view's own hero (here): no Go to Artist", () => {
  assert.ok(!labels(m.artistMenu({ name: "Artist", songs: [song], inLibrary: true }, { context: "t", here: true })).includes("Go to Artist"));
});

test("a playlist: the §3.4 rows, Shuffle second", () => {
  const p = { name: "P", libraryId: "p.1", canEdit: true, isPublic: false } as unknown as Parameters<Menu["playlistMenu"]>[0];
  assert.deepEqual(labels(m.playlistMenu(p, () => [song], { context: "t" })), ["Play Now", "Shuffle", "Play Next", "Add to Queue", "Add to Playlist", "Go to Playlist", "Copy Link", "Add to Library", "Favorite", "Pin"]);
});

test("a station: Play Now · Add to Queue · Copy Link · Pin", () => {
  const s = { id: "s1", name: "S", url: "https://x" } as unknown as Parameters<Menu["stationMenu"]>[0];
  assert.deepEqual(labels(m.stationMenu(s, { context: "t" })), ["Play Now", "Add to Queue", "Copy Link", "Pin"]);
});

test("a picked set: Play N songs · Play Next · Add to Queue · Add to Playlist, then the card's Remove", () => {
  const items = m.setMenu(() => [song, song, song], 3, "song", { context: "t", away: [{ label: "Remove 3 songs", run() {} }] });
  assert.deepEqual(labels(items), ["Play 3 songs", "Play Next", "Add to Queue", "Add to Playlist", "Remove 3 songs"]);
});
