// The mouse's forward button (docs/architecture/DRAG-DROP.md §6b, DESK-TESTS.md B26), on the dev
// app's Library card. Needs `npm run dev:app` in Max with the Library on screen, in its Albums
// view (the script refuses otherwise: a row in the Songs view PLAYS). It presses the mouse's
// back (3) and forward (4) buttons as mouseup events on the card, reads the header and the
// `ui:forward` lines, and ends at the Library's root with the search closed.
// Pass: every line says ok.
import { execFileSync } from "node:child_process";

const drive = String.raw`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const card = document.querySelector(".panel[data-mounted=library]");
  if (!card) throw new Error("no Library card on screen");
  const pane = () => card.querySelector(".coll-pane[data-pos=center]");
  const view = () => pane()?.querySelector("[data-view]");
  // The page's own name: the hero's title on a level (the header says only "Album"), the
  // card's title at the root.
  const head = () => (pane()?.querySelector(".lib-hero__title") ?? card.querySelector(".panel__title"))?.textContent.trim();
  const deep = () => !card.querySelector(".panel__back").hidden;
  const press = async (button) => {
    view().dispatchEvent(new MouseEvent("mouseup", { button, bubbles: true, cancelable: true }));
    await wait(900);
  };
  const out = [];
  const say = (name, ok, more) => out.push((ok ? "ok    " : "FAIL  ") + name + (more === undefined ? "" : "  " + JSON.stringify(more)));
  const tile = (i) => view().querySelector('[data-idx="' + i + '"]');
  if (deep()) { await press(3); await press(3); await press(3); }
  if (!tile(0)?.querySelector(".lib-row__art, img")) throw new Error("not the Albums view");
  const root = head();

  // two levels: an album, then its artist from the hero's subtitle
  tile(0).click();
  await wait(1000);
  const album = head();
  const isAlbum = deep() && !!pane().querySelector("[data-hero-sub]");
  say("an album opens (a drill, not a play)", isAlbum, { album });
  if (!isAlbum) return out;
  pane().querySelector("[data-hero-sub]").click();
  await wait(1100);
  const artist = head();
  say("its artist opens from the subtitle", deep() && artist !== album, { artist });
  // The artist page is long: scroll it, so Forward can be read for the place.
  const v = view();
  v.scrollTop = Math.min(160, Math.max(0, v.scrollHeight - v.clientHeight));
  await wait(200);
  const artistScroll = view().scrollTop;

  await press(3);
  say("back: the album", head() === album, head());
  await press(3);
  say("back: the root", head() === root && !deep(), head());
  await press(4);
  say("forward: the album", head() === album && deep(), head());
  await press(4);
  say("forward: the artist", head() === artist, head());
  say("forward: at the place left", artistScroll > 0 && Math.abs(view().scrollTop - artistScroll) <= 2, { was: artistScroll, now: view().scrollTop });
  await press(4);
  say("forward with nothing ahead: nothing moves", head() === artist, head());

  // reset: two backs, then a new album by hand; forward does nothing
  await press(3);
  await press(3);
  tile(1).click();
  await wait(1000);
  const other = head();
  await press(4);
  say("a new drill clears the way forward", head() === other && other !== album, { other, now: head() });
  await press(3);
  say("back from it: the root", head() === root && !deep(), head());

  // the search: back closes it, forward opens it again with its text
  card.querySelector("[data-pop=search]").click();
  await wait(300);
  const input = pane().querySelector("[data-search]");
  input.value = "a";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(400);
  const bar = () => pane().querySelector(".lib-searchbar");
  await press(3);
  say("back: the search closes", !bar().classList.contains("is-open") && input.value === "", { open: bar().classList.contains("is-open"), value: input.value });
  await press(4);
  say("forward: the search opens with its text", bar().classList.contains("is-open") && pane().querySelector("[data-search]").value === "a", { value: pane().querySelector("[data-search]").value });
  await press(3);

  const lines = window.__diag.events().filter((e) => e.tag === "ui:forward").slice(-6).map((e) => e.data.took);
  say("ui:forward logs each press", lines.length >= 5, lines);
  return out;
})()`;

const res = execFileSync(process.execPath, ["scripts/webview-eval.mjs", drive], { encoding: "utf8" });
console.log(JSON.parse(res).join("\n"));
