// Page 4 of the grand opening (docs/features/GRAND-OPENING.md §10): "Nitpicks" — the smaller
// settings and rules. His title and subtitle (2026-10-23), then three columns, as on page 1:
//   1. Rules, and the rows next to rules: the look schedule, the playlist web's defaults, and
//      what happens if graphics fail (a built-in rule).
//   2. The app itself: updates, the usage counts, Start with Windows, Close to tray.
//   3. His picks from Claude's list (2026-10-23): Fancy scrubber, Sleep every day, the three
//      Suggest Less rows, Song of the Day, and the song facts (Last.FM play counts, Notes from).
//
// Nothing here is a second copy of a control: the rows are the Settings card's own
// (`mountSettingsParts`), as page 1's third column and the quick panel draw them.
//
// This page tells the user about the usage counts (USAGE-COUNTS.md §2 rule 10): the row is on
// by default, and nothing leaves before this page has been shown (`markUsageTold`).

import type { CardInstance } from "./cards";
import { mountSettingsParts, quickFoldOpen, toggleQuickFold, type SettingsPart } from "./settings-card";
import { markUsageTold } from "./usage";

/** The words on the page (his title and subtitle, 2026-10-23; the column titles are Claude's,
 *  reviewed and kept by him the same day). */
const COPY = {
  title: "Nitpicks",
  sub: "Smaller settings, rules, and such to fine-tune DeetsMusic for ya",
  rules: "Rules and schedules",
  app: "The app",
  extras: "Worth a look",
};

/** A part on this page. Each gets its own fold prefix (`ob4-N`), so the quick panel's folds and
 *  page 1's are untouched, and two parts from one section (Playback, Motion) fold apart. */
const part = (n: number, p: Omit<SettingsPart, "fold">): SettingsPart => ({ ...p, fold: `ob4-${n}` });
const RULES: SettingsPart[] = [
  part(1, { title: "Look schedule" }),
  part(2, { title: "Playlists", rows: ["webreach", "websize", "webprefer", "webseedfilter"], label: "Playlist Web Defaults" }),
  part(3, { title: "Motion", rows: ["graphicsfallback"], label: "Graphics" }),
];
const APP: SettingsPart[] = [
  part(4, { title: "Updates", rows: ["updatemode"] }),
  part(5, { title: "About", rows: ["usage"], label: "Usage counts" }),
  part(6, { title: "Window", rows: ["autostart", "tray"], label: "Startup" }),
];
const EXTRAS: SettingsPart[] = [
  part(7, { title: "Motion", rows: ["fancyscrub"], label: "Fancy scrubber" }),
  part(8, { title: "Sleep", rows: ["sleepsched"], label: "Sleep" }),
  part(9, { title: "Playback", rows: ["suggeststations", "suggestwebs", "suggestqueue"], label: "Suggest Less" }),
  part(10, { title: "Song of the Day", rows: ["sotd"] }),
  part(11, { title: "Playback", rows: ["listeners", "notessource"], label: "Song facts" }),
];

/** The groups opened for the user once this session; after that, a fold here is theirs. */
const opened = new Set<string>();

export function mountNitpicks(host: HTMLElement): CardInstance {
  host.innerHTML =
    `<div class="onboarding__sheet app-scroll">` +
    `<header class="onboarding__hello"><h1 class="onboarding__hi"></h1><p class="onboarding__sub"></p></header>` +
    `<div class="onboarding__cols">` +
    `<section class="onboarding__col" data-col="rules"><h2 class="panel__title"></h2></section>` +
    `<section class="onboarding__col" data-col="app"><h2 class="panel__title"></h2></section>` +
    `<section class="onboarding__col" data-col="extras"><h2 class="panel__title"></h2></section>` +
    `</div></div>`;
  host.querySelector(".onboarding__hi")!.textContent = COPY.title;
  host.querySelector(".onboarding__sub")!.textContent = COPY.sub;
  for (const col of ["rules", "app", "extras"] as const) host.querySelector(`[data-col="${col}"] .panel__title`)!.textContent = COPY[col];

  // A part's first group starts folded in the quick panel; here every group starts open (the
  // rows are the point of the page). A part with sub-headings (Look schedule) folds by group.
  for (const p of [...RULES, ...APP, ...EXTRAS]) {
    const key = `${p.fold}${p.title}::`;
    if (opened.has(key)) continue;
    opened.add(key);
    if (!quickFoldOpen(key)) toggleQuickFold(key);
  }
  const mount = (col: string, parts: SettingsPart[]) => {
    const at = document.createElement("div");
    host.querySelector(`[data-col="${col}"]`)!.append(at);
    return mountSettingsParts(at, parts, "onboarding");
  };
  const rules = mount("rules", RULES);
  const app = mount("app", APP);
  const extras = mount("extras", EXTRAS);
  markUsageTold("grand opening page 4");

  return {
    destroy() {
      rules.destroy();
      app.destroy();
      extras.destroy();
      host.replaceChildren();
    },
  };
}
