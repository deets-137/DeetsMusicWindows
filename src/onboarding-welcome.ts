// Page 1 of the grand opening (docs/features/GRAND-OPENING.md §5): "Hi", the welcome line,
// and three columns — Apple Music, Last.fm, and the rest (Discord, the MCP, AirPlay).
//
// Nothing here is a second copy of a control. The two account buttons MIRROR the title
// menu's own (index.html, the DeetsMusic menu › Account): a click here clicks the original,
// and every change the original paints (its state, its sigil, its status line) is copied
// back here. main.ts and lastfm.ts stay the only code that signs in. The third column's rows
// are the Settings card's own rows (`mountSettingsParts`), as the quick panel draws them.

import type { CardInstance } from "./cards";
import { mountSettingsParts, quickFoldOpen, toggleQuickFold } from "./settings-card";
import { speakersKnown, scanSpeakers, isScanning, connectSpeaker, type Speaker } from "./airplay";
import * as diag from "./diag";

/** The groups opened for the user once this session; after that, a fold here is theirs. */
const opened = new Set<string>();

/** The words on the page (his, 2026-10-22). */
const COPY = {
  title: "Hi",
  sub: "Welcome to DeetsMusic, let's get you set up and get the music bumpin",
  apple: [
    "Music in DeetsMusic is streamed straight through Apple Music. Your library, playlists, and radios carry over while your plays in DeetsMusic go to Apple towards your annual Replays.",
  ],
  lastfm: [
    "Last.FM is one of the OGs of replays and recommendations. Log in to scrobble (ie log your plays) if you want a more granular ability to look back on listening habits. Last.FM is also great at showing related artists and putting you onto the next hit.",
    "(I created a Last.FM account developing this after seeing all the subreddit requests and... woah. Highly recommend, its quite cool if you aren't on Last.FM yet)",
  ],
};

/**
 * A live copy of one `.account` block from the title menu. The copy carries no id and no
 * `data-acct-*` mark, so nothing else finds it. A click on its button clicks the original's;
 * a click on a link in its status line (the local sign-in fallback, the Last.fm profile)
 * clicks the original's link at the same place.
 */
function mirrorAccount(src: HTMLElement): { el: HTMLElement; destroy: () => void } {
  const el = document.createElement("div");
  el.className = "account onboarding__account";
  const copy = () => {
    const c = src.cloneNode(true) as HTMLElement;
    for (const n of [c, ...c.querySelectorAll<HTMLElement>("*")]) {
      n.removeAttribute("id");
      for (const a of [...n.attributes]) if (a.name.startsWith("data-acct")) n.removeAttribute(a.name);
    }
    el.replaceChildren(...c.childNodes);
  };
  copy();
  const watch = new MutationObserver(copy);
  watch.observe(src, { subtree: true, childList: true, attributes: true, characterData: true });
  el.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const link = t.closest<HTMLElement>(".account__link");
    if (link) {
      const i = [...el.querySelectorAll(".account__link")].indexOf(link);
      src.querySelectorAll<HTMLElement>(".account__link")[i]?.click();
      return;
    }
    if (t.closest(".account__btn")) src.querySelector<HTMLElement>(".account__btn")?.click();
  });
  return { el, destroy: () => watch.disconnect() };
}

/** The AirPlay part: the speakers found so far, each one a "Play on" row, and a button that
 *  looks again. It never scans on its own: a look is the user's press (the network, a few
 *  seconds, and on some PCs the Windows network prompt). */
function speakersPart(): HTMLElement {
  const box = document.createElement("div");
  box.className = "onboarding__speakers";
  const render = () => {
    const list = speakersKnown();
    box.innerHTML =
      `<div class="set__head">AirPlay speakers</div>` +
      `<div class="ap__list onboarding__speaker-list"></div>` +
      `<button class="account__btn onboarding__scan" type="button" title="Looks for AirPlay speakers on your network">` +
      `<span class="account__label">${isScanning() ? "Looking for speakers…" : list.length ? "Look again" : "Look for speakers"}</span></button>`;
    const rows = box.querySelector<HTMLElement>(".onboarding__speaker-list")!;
    if (!list.length) {
      const none = document.createElement("div");
      none.className = "account__status";
      none.textContent = "No speakers found yet.";
      rows.append(none);
    }
    list.forEach((s: Speaker) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ap__row";
      row.title = "Plays your music on this speaker";
      const name = document.createElement("span");
      name.className = "ap__name";
      name.textContent = s.name;
      row.append(name);
      row.addEventListener("click", () => void connectSpeaker(s).catch((e) => diag.warn("onboarding:speaker", { e: String(e) })));
      rows.append(row);
    });
    const scan = box.querySelector<HTMLButtonElement>(".onboarding__scan")!;
    scan.disabled = isScanning();
    scan.addEventListener("click", () => {
      diag.log("onboarding:scan");
      const done = scanSpeakers().catch((e) => diag.warn("onboarding:scan", { e: String(e) }));
      render();
      void done.then(() => box.isConnected && render());
    });
  };
  render();
  return box;
}

export function mountWelcome(host: HTMLElement): CardInstance {
  host.innerHTML =
    `<div class="onboarding__sheet app-scroll">` +
    `<header class="onboarding__hello"><h1 class="onboarding__hi"></h1><p class="onboarding__sub"></p></header>` +
    `<div class="onboarding__cols">` +
    `<section class="onboarding__col" data-col="apple"><h2 class="panel__title">Apple Music</h2></section>` +
    `<section class="onboarding__col" data-col="lastfm"><h2 class="panel__title">Last.FM</h2></section>` +
    `<section class="onboarding__col" data-col="more"></section>` +
    `</div></div>`;
  host.querySelector(".onboarding__hi")!.textContent = COPY.title;
  host.querySelector(".onboarding__sub")!.textContent = COPY.sub;

  const stops: (() => void)[] = [];
  const account = (col: string, sel: string, paras: string[]) => {
    const src = document.querySelector<HTMLElement>(sel);
    const at = host.querySelector<HTMLElement>(`[data-col="${col}"]`)!;
    if (src) {
      const m = mirrorAccount(src);
      at.append(m.el);
      stops.push(m.destroy);
    }
    for (const text of paras) {
      const p = document.createElement("p");
      p.className = "onboarding__body";
      p.textContent = text;
      at.append(p);
    }
  };
  account("apple", ".account:has(#account-action)", COPY.apple);
  account("lastfm", "#lastfm-account", COPY.lastfm);

  // The rest: Settings' own rows, then the speakers.
  const more = host.querySelector<HTMLElement>('[data-col="more"]')!;
  const rowsHost = document.createElement("div");
  more.append(rowsHost);
  // A part's groups start folded in the quick panel; here they start open (the rows are the
  // point of the page). The fold keys carry the "ob" prefix, so the quick panel's own folds
  // are untouched, and a group the user folds here stays folded for the rest of the session.
  for (const key of ["obSharing::", "obConnections::"]) {
    if (opened.has(key)) continue;
    opened.add(key);
    if (!quickFoldOpen(key)) toggleQuickFold(key);
  }
  const rows = mountSettingsParts(rowsHost, [
    { title: "Sharing", rows: ["shareDiscord"], label: "Discord", fold: "ob" },
    { title: "Connections", rows: ["mcpsetup", "mcpapps"], label: "AI apps", fold: "ob" },
  ]);
  more.append(speakersPart());

  return {
    destroy() {
      stops.forEach((f) => f());
      rows.destroy();
      host.replaceChildren();
    },
  };
}
