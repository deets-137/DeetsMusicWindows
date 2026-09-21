// The quick panel (docs/features/QUICK-SETTINGS.md): the cog's panel. A Tips line, then one row of
// squares: Apple Music and Discord, five app icons sorted by how many rows they hold, and a
// right cluster (Updates and bugs, Reset, the cog = All settings). A press on a square makes
// the panel taller and shows its settings; a press on the same square shuts them again, a
// press on another swaps them. A square wears a New badge until its first press (§8).
//
// The rows are the Settings card's own sections, drawn by the card's own code
// (`mountSettingsParts`), so a row here and the same row in Settings can never disagree.
// The Apple Music sign-in is the title menu's Account row, painted by main.ts into both
// copies. Motion: the panel's `.pop` arrival, its parts through `enterRows` (src/pop.ts),
// and the height moves to the new content the way the "Play on" panel's does.

import { makeDropdown, type DropdownHandle } from "./dropdown";
import { enterRows } from "./pop";
import { mountSettingsParts, unseenNewIn, unseenNewAny, seedNewMarks, type SettingsPart } from "./settings-card";
import { APPLE_SIGIL } from "./apple-sigil";
import { requestCard, requestSetting } from "./layout-bus";
import { setting, setSetting, onSettingsChange } from "./settings-store";
import { expandCard, isGrownCard, collapseGrow, onGrowChange } from "./card-grow";
import { tokenMs } from "./boot-cover";
import type { CardInstance } from "./cards";
import * as diag from "./diag";

type Part = "apple" | "discord" | "window" | "look" | "help" | "agents" | "fun" | "bugs" | "reset";

/** What each icon shows (QUICK-SETTINGS.md §3). Apple Music: its section and AirPlay, under
 *  the sign-in row. Discord: its own section, then the one Discord row of Sharing. Window:
 *  the Window section. The brush: the look schedule, the skin's own rows (a part with no
 *  row under this skin is left out) and Motion. */
const PARTS: Record<Part, SettingsPart[]> = {
  apple: [{ title: "Apple Music" }, { title: "AirPlay" }],
  discord: [{ title: "Discord" }, { title: "Sharing", rows: ["shareDiscord"] }],
  window: [{ title: "Window" }],
  look: [{ title: "Look schedule" }, { title: "Skin settings" }, { title: "Motion" }],
  help: [{ title: "Menus, hints and notices" }, { title: "Playback" }],
  agents: [{ title: "Connections" }],
  fun: [{ title: "Song of the Day" }, { title: "Friends" }],
  bugs: [{ title: "Updates" }, { title: "Bugs" }],
  reset: [{ title: "Reset" }],
};

/** The app icons, drawn for this panel from his sketches (§5.2). Stroked in the ink (not a brand mark): the
 *  front shape in the icon's own color, the Window icon's back pane in --subtext. */
const WINDOW_GLYPH =
  `<svg class="quick__glyph" viewBox="0 0 24 24" aria-hidden="true">` +
  `<path class="quick__glyph-back" d="M18 5.5h2.5v15h-15V18"/>` +
  `<rect x="3" y="3" width="15" height="15"/><rect x="6" y="6" width="9" height="9"/><path d="M10.5 6v9M6 10.5h9"/></svg>`;
const BRUSH_GLYPH =
  `<svg class="quick__glyph" viewBox="0 0 24 24" aria-hidden="true">` +
  // the handle, a long slim leaf up and to the right
  `<path d="M11.2 12.8C13.6 9.4 17 5.6 20.2 3.4c.4-.3.8.1.5.5-2.2 3.2-6 6.6-9.4 9z"/>` +
  // the bristles: a round tip that ends in a point, bottom left
  `<path d="M10.4 12.3l1.3 1.3c.2 1.9-.6 3.6-2.3 4.6-1.6.9-3.6 1-5.4 1.8.6-1.8.8-3.7 1.8-5.3 1-1.7 2.8-2.5 4.6-2.4z"/></svg>`;
/** Help (menus, hints and notices + playback): a helipad — an H in a ring. */
const HELIPAD_GLYPH =
  `<svg class="quick__glyph" viewBox="0 0 24 24" aria-hidden="true">` +
  `<circle cx="12" cy="12" r="9"/><path d="M9 7.5v9M15 7.5v9M9 12h6"/></svg>`;
/** Connections (agents): a robot's head — antennae, a cap, ears, two eye slots, a nose, a
 *  mouth, a neck. The teeth of his sketch are left out: at 16 px they read as noise. */
const ROBOT_GLYPH =
  `<svg class="quick__glyph" viewBox="0 0 24 24" aria-hidden="true">` +
  `<path d="M9.2 5.5L7.6 3.4M14.8 5.5l1.6-2.1"/>` +
  `<rect x="8.5" y="5.5" width="7" height="2.5"/><rect x="5.5" y="8" width="13" height="10.5"/>` +
  `<path d="M5.5 10.5H3.8v4.5h1.7M18.5 10.5h1.7v4.5h-1.7"/>` +
  `<path d="M7.8 11h2.8M13.4 11h2.8M12 12.6v1.6M8.5 16.2h7"/><path d="M10.5 18.5v2h3v-2"/></svg>`;
/** Song of the Day and Friends, the fun things: a jellyfishing net — a hoop, a mesh, a bag
 *  hanging from it, and a long handle down to the left. */
const NET_GLYPH =
  `<svg class="quick__glyph" viewBox="0 0 24 24" aria-hidden="true">` +
  `<path d="M3.2 19.6l8.6-8.6M4.4 20.8l8.6-8.6M3.2 19.6l1.2 1.2"/>` +
  `<circle cx="16.4" cy="7.6" r="4.9"/>` +
  `<path d="M13.4 5.2l6.4 4.9M13.9 11l5.4-7.1M11.8 9.2c.8 3.9 3.5 7.3 6.6 8 1.6-1.8 2.4-4.8 2.6-7.6"/></svg>`;
/** Updates and Bugs: a beetle — an oval body, two antennae, three bent legs a side. */
const BUG_GLYPH =
  `<svg class="quick__glyph" viewBox="0 0 24 24" aria-hidden="true">` +
  `<ellipse cx="12" cy="13.5" rx="4.2" ry="5.8"/>` +
  `<path d="M10.3 8.1L8.8 5.2 9.8 3.4M13.7 8.1l1.5-2.9-1-1.8"/>` +
  `<path d="M8.2 10.6L5.6 9.1 4.9 6.6M7.8 13.8H4.9l-1.4 1.9M8.4 16.9l-2.3 1.4-.8 2.3"/>` +
  `<path d="M15.8 10.6l2.6-1.5.7-2.5M16.2 13.8h2.9l1.4 1.9M15.6 16.9l2.3 1.4.8 2.3"/></svg>`;
/** Reset: a ring with two arrowheads chasing each other, the top one right, the bottom one left. */
const RESET_GLYPH =
  `<svg class="quick__glyph" viewBox="0 0 24 24" aria-hidden="true">` +
  `<circle cx="12" cy="12" r="7"/>` +
  `<path class="quick__glyph-fill" d="M10.6 2.6L15 5l-4.4 2.4zM13.4 16.6L9 19l4.4 2.4z"/></svg>`;

/** Discord's official symbol (the brand kit's Discord-Symbol-*.svg), path unmodified. The
 *  fill is --discord-mark: the black or the white file by theme, never a theme tint. */
const DISCORD_MARK =
  `<svg class="quick__mark quick__mark--discord" viewBox="0 0 126.644 96" role="img" aria-label="Discord"><path d="` +
  `M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568` +
  `C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523` +
  `.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623` +
  `,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505Z` +
  `M42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535Z` +
  `M84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z"/></svg>`;
/** Apple's official monochrome Apple Music icon — the one apple-sigil.ts carries. */
const APPLE_MARK = APPLE_SIGIL.replace(/class="[^"]*"/, 'class="quick__mark quick__mark--apple"');

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let dropdown: DropdownHandle | null = null;

/** Open the panel from elsewhere (the Compass's Places row, COMPASS.md §9). */
export function openQuickPanel(): void {
  dropdown?.open();
}

/** Wire the cog's panel. Call once, BEFORE main.ts paints the Account row: the Apple part
 *  holds the second copy of it, and main.ts collects the copies when it starts. */
export function initQuickPanel(): void {
  const root = document.getElementById("quick");
  const cog = document.getElementById("cog-open");
  const panel = document.getElementById("quick-panel");
  const body = document.getElementById("quick-body");
  const rowsHost = document.getElementById("quick-rows");
  const acct = panel?.querySelector<HTMLElement>("[data-quick-part='apple']");
  const all = document.getElementById("quick-all");
  if (!root || !cog || !panel || !body || !rowsHost || !acct || !all) return;

  panel.querySelector("[data-quick='apple']")!.innerHTML = APPLE_MARK;
  panel.querySelector("[data-quick='discord']")!.innerHTML = DISCORD_MARK;
  panel.querySelector("[data-quick='window']")!.innerHTML = WINDOW_GLYPH;
  panel.querySelector("[data-quick='look']")!.innerHTML = BRUSH_GLYPH;
  panel.querySelector("[data-quick='help']")!.innerHTML = HELIPAD_GLYPH;
  panel.querySelector("[data-quick='agents']")!.innerHTML = ROBOT_GLYPH;
  panel.querySelector("[data-quick='fun']")!.innerHTML = NET_GLYPH;
  panel.querySelector("[data-quick='bugs']")!.innerHTML = BUG_GLYPH;
  panel.querySelector("[data-quick='reset']")!.innerHTML = RESET_GLYPH;
  all.innerHTML = cog.innerHTML; // the panel's cog is the title bar's own glyph

  // ── the cog keeps its turn: every press adds --cog-step, open or shut. A press on the
  //    panel's cog turns the title bar one too: the panel shuts as it acts. ──
  let cogTurns = 0;
  const turn = () => {
    cogTurns += 1;
    cog.style.setProperty("--cog-angle", `calc(var(--cog-step) * ${cogTurns})`);
  };
  cog.addEventListener("click", turn);

  // ── the height follows the new content instead of jumping (airplay.ts's shape) ──
  let grow: Animation | null = null;
  const animateHeight = (from: number) => {
    grow?.cancel();
    grow = null;
    panel.classList.remove("is-growing");
    if (panel.hidden || !from || reduced()) return;
    const to = panel.offsetHeight;
    if (Math.abs(to - from) < 1) return;
    panel.classList.add("is-growing");
    const a = panel.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: tokenMs("--pop-grow"),
      easing: getComputedStyle(panel).getPropertyValue("--pop-ease").trim() || "ease",
    });
    grow = a;
    a.onfinish = () => {
      if (grow !== a) return;
      grow = null;
      panel.classList.remove("is-growing");
    };
  };

  // ── the open part: one at a time, remounted on each press ──
  let open: Part | null = null;
  let rows: CardInstance | null = null;
  const show = (part: Part | null) => {
    const from = panel.offsetHeight;
    rows?.destroy();
    rows = null;
    open = part;
    panel.querySelectorAll<HTMLElement>("[data-quick]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.quick === part)));
    body.hidden = !part;
    acct.hidden = part !== "apple";
    if (part) {
      rows = mountSettingsParts(rowsHost, PARTS[part]);
      const parts = [...(part === "apple" ? [acct] : []), ...rowsHost.querySelectorAll(".set__section > *")];
      enterRows(parts);
      diag.log("quick:part", { part });
    }
    animateHeight(from);
  };

  // ── The panel's cog: All settings (the cog's old job), or Collapse while Settings is
  //    grown — then it wears the pressed fill, as a logo whose rows are open does. ──
  const paintAll = () => {
    const grown = isGrownCard("settings");
    all.setAttribute("aria-pressed", String(grown));
    all.setAttribute("aria-label", grown ? "Collapse settings" : "All settings");
    all.title = grown ? "Collapse settings: puts Settings back in its place" : "All settings: opens Settings at full size";
  };
  all.addEventListener("click", () => {
    turn();
    dropdown?.close();
    if (isGrownCard("settings")) {
      void collapseGrow("cog");
      return;
    }
    requestCard("settings");
    void expandCard("settings", "cog");
  });
  onGrowChange(paintAll);

  // ── New badges (QUICK-SETTINGS.md §8): a square you have never pressed wears one. The
  //    first press takes it off for good; Show the tour again puts them all back. ──
  const squares = [...panel.querySelectorAll<HTMLElement>(".quick__logo")];
  const idOf = (el: HTMLElement) => el.dataset.quick ?? "all"; // the panel's cog has no part
  // A square also shows its N again while a row or section inside it is new and not yet
  // hovered (§10, his call), so the badge leads you to the new row.
  // The title bar cog wears one too (§11, his call 2026-09-21): until the first press on it,
  // for everyone, an upgrade included; and again while any New mark is unseen. Its key is
  // "cog", so Show the tour again puts it back with the squares.
  const paintNew = () => {
    const seen = setting("quickSeen");
    cog.toggleAttribute("data-new", !seen.includes("cog") || unseenNewAny());
    for (const el of squares) {
      const part = el.dataset.quick as Part | undefined;
      el.toggleAttribute("data-new", !seen.includes(idOf(el)) || (!!part && unseenNewIn(PARTS[part])));
    }
  };
  seedNewMarks(); // a brand-new install: today's New marks are not new to them (§10)
  paintNew();
  onSettingsChange((k) => { if (k === "quickSeen") paintNew(); });
  cog.addEventListener("click", () => {
    const seen = setting("quickSeen");
    if (!seen.includes("cog")) setSetting("quickSeen", [...seen, "cog"]);
  });
  panel.addEventListener("click", (e) => {
    const sq =(e.target as HTMLElement).closest<HTMLElement>(".quick__logo");
    if (!sq) return;
    const seen = setting("quickSeen");
    if (!seen.includes(idOf(sq))) setSetting("quickSeen", [...seen, idOf(sq)]);
  });

  // ── the Tips pointer: Tips stay in the Settings card; the line takes you to them ──
  panel.querySelector("[data-quick-tips]")?.addEventListener("click", () => {
    dropdown?.close();
    requestSetting("tour"); // opens Settings, unfolds Tips, flashes Show the tour again
  });

  panel.addEventListener("click", (e) => {
    const logo = (e.target as HTMLElement).closest<HTMLElement>("[data-quick]");
    if (!logo) return;
    const part = logo.dataset.quick as Part;
    show(open === part ? null : part);
  });

  dropdown = makeDropdown({
    root,
    trigger: cog,
    panel,
    // A row's menu (a split half's list) and the right-click menu are portaled to <body>:
    // a press in them is a press in this panel.
    alsoInside: () => [...document.querySelectorAll(".set__menu:not([hidden]), .ctx-menu")],
    onOpen: () => {
      paintAll();
      keepRightInWindow(root, panel);
      enterRows([...panel.querySelectorAll(".quick__tips, .quick__bar > *")]);
      // A part left open last time comes back with the panel, drawn fresh.
      if (open) show(open);
    },
  });
  window.addEventListener("resize", () => { if (!panel.hidden) keepRightInWindow(root, panel); });
}

/** The panel hangs from the cog's left edge (`left: 0`); in a narrow window it would pass
 *  the right edge, so move it left by the difference, less --panel-edge-gap. The mirror of
 *  dropdown.ts `keepInWindow`, which serves the right-anchored panels. */
function keepRightInWindow(anchor: HTMLElement, panel: HTMLElement): void {
  panel.style.left = "";
  const gap = parseFloat(getComputedStyle(panel).getPropertyValue("--panel-edge-gap")) || 0;
  const right = anchor.getBoundingClientRect().left + panel.offsetWidth;
  const over = right - (document.documentElement.clientWidth - gap);
  if (over > 0) panel.style.left = `${-over}px`;
}
