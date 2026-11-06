// The Donate button and its panel (docs/features/donate.md): the Max title bar button left of the
// Network button.
//
// His glyph move (2026-11-04): each open turns the dollar sign over. The line leaves through the
// top, the S pulls straight and becomes the new line, and a new stroke comes in from the bottom
// left, goes through that line, and curls into the new S. Each close plays it backwards.

import "./styles/donate.css";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { applyCss } from "./dom";
import { fillGoals, keptTotal } from "./donate-rules";
import { makeDropdown, type DropdownHandle } from "./dropdown";
import { enterRows } from "./pop";
import { keepRightInWindow } from "./quick-panel";
import { tokenMs } from "./boot-cover";
import { motionReduced } from "./motion";
import { currentSurface } from "./surface";
import * as diag from "./diag";

/** His PayPal donate page (2026-11-05). It opens in the browser: the app never touches a card,
 *  and PayPal does not support its page in a web view (ideas/donations.md §4). */
const PAYPAL_URL =
  "https://www.paypal.com/donate/?business=T5AABZGWDAXUJ&no_recurring=0&item_name=Support+DeetsMusic%27s+growth+and+unlock+new+features+like+lyrics%21&currency_code=USD";

/** The last total read, kept on this PC. Not a setting: it is a copy of his number. */
const TOTAL_KEY = "deets.donateTotal";

/** The top of the panel, a paragraph each. The words are his (2026-11-05). */
const SAY = [
  "Hey folks, here's the deal. DeetsMusic is my passion project and has been keeping me going for the past couple months as I entered unemployment and search for a new software/solutions/product/healthtech job in this brutal market. I very much plan to continue working on it to the best of my abilities, but certain ideas I have and things I want to do are price-gated, with the first and biggest one being synced lyrics.",
  "Musixmatch is what Spotify and Apple pull from themselves, considering it the gold standard for timed lyrics. If we can reach the $50 mark for donations, that would allow us to get v0.9 of lyrics up and running, with me trying to time-sync the lyrics myself. At the $200 mark, we get more songs and Musixmatch's help with time-syncing for the best quality. If you have a couple bucks to spare, I'd greatly appreciate it and the community would too.",
];

/** The S, from its top right end to its bottom left end: six curves. */
const S_POINTS = [
  [16.6, 7.9],
  [16.2, 5.9], [14.4, 4.9], [12, 4.9],
  [9.2, 4.9], [7.2, 6.2], [7.2, 8.4],
  [7.2, 10.7], [9.5, 11.4], [12, 12],
  [14.5, 12.6], [16.8, 13.3], [16.8, 15.6],
  [16.8, 17.8], [14.8, 19.1], [12, 19.1],
  [9.6, 19.1], [7.8, 18.1], [7.4, 16.1],
];
const LINE_TOP = 3;
const LINE_BOTTOM = 21;

/** Points to a path of the S's own shape: the browser blends two paths only when their commands match. */
const pathOf = (pts: number[][]): string => {
  const [first, ...rest] = pts;
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 0; i < rest.length; i += 3) d += ` C${rest[i].join(" ")} ${rest[i + 1].join(" ")} ${rest[i + 2].join(" ")}`;
  return d;
};
/** A straight line drawn with as many points as the S has. */
const straight = (x0: number, y0: number, x1: number, y1: number): string => {
  const last = S_POINTS.length - 1;
  return pathOf(S_POINTS.map((_, i) => [x0 + ((x1 - x0) * i) / last, y0 + ((y1 - y0) * i) / last]));
};

const S_PATH = pathOf(S_POINTS);
/** Where the old S ends: exactly on the line that left. */
const LINE_PATH = straight(12, LINE_TOP, 12, LINE_BOTTOM);
/** The new stroke as it comes in: bottom left to top right, through the middle of the line. */
const THREAD_PATH = straight(19.5, 4.5, 4.5, 19.5);
const css = (d: string) => `path("${d}")`;

/** One bar in the panel: its name above, its marks in dollars, and a line of text for each mark
 *  below. The last mark is the bar's full length. */
interface Goal {
  name: string;
  marks: { at: number; text: string }[];
}
/** His goals (2026-11-04), in fill order: see `fillGoals`. The words are his. */
const GOALS: Goal[] = [
  {
    name: "Lyrics",
    marks: [
      { at: 50, text: "500 songs per day between all users for one month" },
      { at: 200, text: "2000 songs per day between all users for one month" },
    ],
  },
  {
    name: "Apple Dev Account",
    marks: [{ at: 100, text: "one year of apple dev access" }],
  },
];

declare global {
  interface Window {
    /** Dev only: show the bars at a pretend amount, until the next read of the total.
     *  `__donate.raised(75)`. */
    __donate?: { raised: (dollars: number) => void; take: (dollars: number | null) => void };
  }
}

const goalTop = (g: Goal) => g.marks[g.marks.length - 1].at;

function goalHtml(g: Goal): string {
  const top = goalTop(g);
  const ticks = g.marks.map((m) => `<span class="donate__tick" data-css="--donate-at: ${m.at / top}"></span>`).join("");
  const lines = g.marks.map((m) => `<li>$${m.at} - ${m.text}</li>`).join("");
  return (
    `<section class="donate__goal"><div class="donate__name">${g.name}</div>` +
    `<div class="donate__bar" role="progressbar" aria-label="${g.name}" aria-valuemin="0" aria-valuemax="${top}" aria-valuenow="0">` +
    `<span class="donate__fill"></span>${ticks}</div>` +
    `<ul class="donate__marks">${lines}</ul></section>`
  );
}

let dropdown: DropdownHandle | null = null;

/** Open the panel (the Compass row). Max only, as the button. */
export function openDonatePanel(): boolean {
  if (currentSurface() !== "max" || !dropdown) return false;
  dropdown.open();
  return true;
}

export function initDonateButton(): void {
  const net = document.getElementById("net");
  if (!net) return;

  const root = document.createElement("div");
  root.className = "donate";
  root.id = "donate";
  root.innerHTML =
    `<button class="donate__btn" id="donate-open" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Donate" title="Donate">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="donate__line" d="M12 ${LINE_TOP}V${LINE_BOTTOM}"/><path class="donate__s" d="${S_PATH}"/><path class="donate__thread" d="${S_PATH}"/></svg></button>` +
    `<div class="donate__panel pop app-scroll" id="donate-panel" role="group" aria-label="Donate" data-frames="donate" data-tauri-drag-region="false" hidden>` +
    `<div class="donate__head">Donate</div>` +
    `<div class="donate__say">${SAY.map((p) => `<p>${p}</p>`).join("")}</div>` +
    `<div class="donate__act"><button class="account__link donate__link" type="button" title="Opens PayPal's donation page in your browser">Donate with PayPal</button>` +
    `<span class="donate__note">(not tax-deductible*)</span></div>` +
    `<div class="donate__rule" role="separator"></div>${GOALS.map(goalHtml).join("")}</div>`;
  applyCss(root); // the marks' places (data-css: the CSP refuses style="…", CSP.md §3)
  net.before(root);

  const btn = root.querySelector<HTMLElement>(".donate__btn")!;
  const panel = root.querySelector<HTMLElement>(".donate__panel")!;
  root.querySelector(".donate__link")!.addEventListener("click", () => void openUrl(PAYPAL_URL));
  const showRaised = (dollars: number) => {
    const tops = GOALS.map(goalTop);
    const held = fillGoals(tops, dollars);
    root.querySelectorAll<HTMLElement>(".donate__bar").forEach((bar, i) => {
      bar.style.setProperty("--donate-raised", String(held[i] / tops[i]));
      bar.setAttribute("aria-valuenow", String(held[i]));
    });
  };
  // The last amount shows at once, while the panel is shut, so an open with no change moves
  // nothing. Only a new amount slides, by the fill's transition (donate.md § The total).
  let shown = keptTotal(localStorage.getItem(TOTAL_KEY));
  showRaised(shown);
  const takeTotal = (dollars: number | null) => {
    if (dollars === null || dollars === shown) return;
    shown = dollars;
    showRaised(dollars);
    localStorage.setItem(TOTAL_KEY, String(dollars));
    diag.log("donate:total", { dollars });
  };
  const readTotal = () => {
    invoke<number | null>("donate_total")
      .then(takeTotal)
      .catch((e) => diag.log("donate:totalFailed", { error: String(e) }));
  };
  if (import.meta.env.DEV) window.__donate = { raised: showRaised, take: takeTotal };
  const line = root.querySelector(".donate__line")!;
  const s = root.querySelector(".donate__s")!;
  const thread = root.querySelector(".donate__thread")!;

  // The three strokes run on one clock, so a press in mid-turn can reverse them together. Each
  // ends on the picture it started from, so nothing jumps when the animations let go.
  let live: Animation[] = [];
  let goingBack = false;
  const turn = (back: boolean) => {
    if (motionReduced()) return;
    if (live[0]?.playState === "running") {
      if (back === goingBack) return;
      goingBack = back;
      for (const a of live) a.reverse();
      return;
    }
    goingBack = back;
    const cs = getComputedStyle(root);
    const y = parseFloat(cs.getPropertyValue("--donate-travel")) || 0;
    // The leaving strokes on the app's own curve, the arrival on the turn's (the updates roll's).
    const arrive = cs.getPropertyValue("--donate-turn").trim().replace(/^\S+\s*/, "") || "ease";
    const leave = cs.getPropertyValue("--ease-ui").trim() || "ease";
    const timing: KeyframeAnimationOptions = { duration: tokenMs("--donate-turn"), direction: back ? "reverse" : "normal" };
    const gone = { transform: `translateY(${-y}px)`, opacity: 0 };
    const away = `translate(${-y}px, ${y}px)`;
    live = [
      line.animate([{ transform: "translateY(0)", opacity: 1, easing: leave }, { ...gone, offset: 0.38 }, { ...gone, offset: 1 }], timing),
      s.animate([{ d: css(S_PATH), easing: leave }, { d: css(LINE_PATH), offset: 0.45 }, { d: css(LINE_PATH), offset: 1 }], timing),
      thread.animate(
        [
          { transform: away, d: css(THREAD_PATH), opacity: 1, offset: 0 },
          { transform: away, d: css(THREAD_PATH), opacity: 1, offset: 0.3, easing: leave },
          { transform: "translate(0, 0)", d: css(THREAD_PATH), opacity: 1, offset: 0.62, easing: arrive },
          { transform: "translate(0, 0)", d: css(S_PATH), opacity: 1, offset: 1 },
        ],
        timing,
      ),
    ];
  };
  // Every open and every close, by any path (the updates arrows' roll does the same).
  new MutationObserver(() => turn(panel.hidden)).observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  dropdown = makeDropdown({
    root,
    trigger: btn,
    panel,
    use: "panel.donate",
    onOpen: () => {
      keepRightInWindow(root, panel);
      enterRows([...panel.children]);
      diag.log("donate:open", {});
      readTotal();
    },
  });
  window.addEventListener("resize", () => {
    if (!panel.hidden) keepRightInWindow(root, panel);
  });
}
