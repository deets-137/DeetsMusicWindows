// The updates button (docs/ideas/UpdatesButton.md): the Max title bar button right of the
// Compass, and its panel. His glyph: two arrows, down on the left, up on the right.
//   - An update offered (available, downloading or ready, and not skipped): the up arrow
//     flies off the top, the down arrow moves to the middle, the button takes the highlight.
//   - Downloading: a thin bar slides in under it and fills with the bytes (F5).
//   - After an install: the New dot until the panel is first opened in that version; What's
//     new opens unfolded that one time (F4).
// The panel: the version row (the updater's own status words and its one action), What's new
// (the bold leads of the offered version's notes, or the installed version's, from the build),
// and Bugs and suggestions (the Settings card's Bugs rows, drawn by its own code, F3).
// No new Rust and no new network call: every state is updater.ts's (`onUpdateStatus`).
// The toasts stay (F2): this is a second, quiet place for the same news.

import "./styles/updates.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import built from "virtual:release-notes";
import { makeDropdown, type DropdownHandle } from "./dropdown";
import { enterRows } from "./pop";
import { onUpdateStatus, updateStatus, updateStatusWords, isDevBuild, isRequiredUpdate, checkForUpdate, download, restartNow, type UpdateStatus } from "./updater";
import { releaseLeads } from "./release-leads";
import { mountSettingsParts, quickFoldOpen, toggleQuickFold } from "./settings-card";
import { setting, isFreshInstall } from "./settings-store";
import { openQuickPanel, keepRightInWindow } from "./quick-panel";
import { currentSurface } from "./surface";
import { tokenMs } from "./boot-cover";
import * as frames from "./frames";
import * as diag from "./diag";
import type { CardInstance } from "./cards";

/** The website's release notes, every version (the "All release notes" link). */
const NOTES_URL = "https://deets.solutions/deetsmusic/#releases";
/** The fold key of What's new, in the quick panel's fold store (QUICK-SETTINGS.md §12). */
const NEW_FOLD = "updates::whatsnew";
/** The last version this install opened the panel in (F4). Not a setting: a per-install mark,
 *  like the quick panel's folds. */
const SEEN_KEY = "deets.updates.seen";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const readSeen = (): string | null => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const writeSeen = (v: string) => {
  try {
    localStorage.setItem(SEEN_KEY, v);
  } catch {
    /* storage unavailable: the dot comes back next start */
  }
};

/** A version the user skipped is not news: no highlight, and the row offers Check now. */
const skipped = (s: UpdateStatus): boolean =>
  !!s.version && s.version === setting("updateSkip") && s.state === "available" && !isRequiredUpdate(s);
/** An update is offered: the arrows move and the button lights. */
const offered = (s: UpdateStatus | null): s is UpdateStatus =>
  !!s && !!s.version && (s.state === "available" || s.state === "downloading" || s.state === "ready") && !skipped(s);

declare global {
  interface Window {
    /** Dev only: paint the button and panel in a pretend state, for the desk test (no toast,
     *  no download). `__updates.fake("downloading", 0.4)`, then `__updates.real()`. */
    __updates?: { fake: (state: UpdateStatus["state"], got?: number) => void; real: () => void };
  }
}

let dropdown: DropdownHandle | null = null;
let openWhatsNew = false; // the next open shows What's new unfolded (F4, or the Compass row)

/** Open the panel (the Compass's rows, COMPASS.md §9). In Mini and Midi the button is hidden:
 *  the quick panel's Updates and bugs square holds the same rows there. */
export function openUpdatesPanel(whatsNew = false): void {
  if (currentSurface() !== "max") {
    openQuickPanel("bugs");
    return;
  }
  if (whatsNew) openWhatsNew = true;
  dropdown?.open();
}

export function initUpdatesButton(): void {
  const root = document.getElementById("updates");
  const btn = document.getElementById("updates-open");
  const panel = document.getElementById("updates-panel");
  const top = document.getElementById("updates-top");
  const bugsHost = document.getElementById("updates-bugs");
  if (!root || !btn || !panel || !top || !bugsHost) return;

  // ── the height follows the content (quick-panel.ts's shape) ──
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

  // ── the button ──
  let wasOffer: boolean | null = null; // null: not painted yet
  let wasState = "";
  const paintButton = (s: UpdateStatus | null) => {
    root.hidden = !s?.current; // the web stand-ins answer null: no updater, no button
    if (!s) return;
    const offer = offered(s);
    if (wasOffer === null && offer) {
      // At launch with an offer already known: paint in place, no flight.
      root.setAttribute("data-still", "");
      requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-still")));
    }
    root.toggleAttribute("data-offer", offer);
    root.dataset.state = s.state;
    const got = s.size ? Math.min(1, s.got / s.size) : 0;
    root.style.setProperty("--updates-got", String(got));
    btn.title = offer
      ? s.state === "ready"
        ? `DeetsMusic ${s.version} is ready. Restart to install it`
        : s.state === "downloading"
          ? `Downloading DeetsMusic ${s.version}`
          : `DeetsMusic ${s.version} is available`
      : "Updates, what's new, and bug reports";
    if (offer !== wasOffer || s.state !== wasState) diag.log("updates:btn", { state: s.state, offer, version: s.version });
    wasOffer = offer;
    wasState = s.state;
  };

  // ── the panel's open rolls the arrows (§9, his ask): each leaves the way it points, out of the
  //    glyph's box, and a new one comes in from the other side to take its place. Its close
  //    plays the roll backwards (§9.5): each leaves against the way it points. The inner group
  //    rolls, so the offer's flight on the outer group (the centered down arrow) is kept. ──
  const roll = (back = false) => {
    if (reduced()) return;
    const cs = getComputedStyle(root);
    const y = parseFloat(cs.getPropertyValue("--updates-roll-y")) || 0;
    // The exit on the app's own curve, the entry on the roll's (the Compass needle's overshoot):
    // one curve over both made the exit a snap.
    const enter = cs.getPropertyValue("--updates-roll").trim().replace(/^\S+\s*/, "") || "ease";
    const leave = cs.getPropertyValue("--ease-ui").trim() || "ease";
    const duration = tokenMs("--updates-roll");
    const go = (g: Element | null, dir: 1 | -1) =>
      g?.animate(
        [
          { transform: "translateY(0)", opacity: 1, easing: leave },
          { transform: `translateY(${dir * y}px)`, opacity: 0, offset: 0.4 },
          { transform: `translateY(${-dir * y}px)`, opacity: 0, offset: 0.4, easing: enter },
          { transform: "translateY(0)", opacity: 1 },
        ],
        { duration },
      );
    go(root.querySelector(".updates__up .updates__roll"), back ? 1 : -1);
    go(root.querySelector(".updates__down .updates__roll"), back ? -1 : 1);
  };
  // Every open and every close, by any path (the button, a click away, Escape, the Compass).
  new MutationObserver(() => roll(panel.hidden)).observe(panel, { attributes: true, attributeFilter: ["hidden"] });

  // ── the New dot after an install (F4) ──
  let seenChecked = false;
  const paintNew = (s: UpdateStatus | null) => {
    if (!s?.current) return;
    if (!seenChecked) {
      seenChecked = true;
      // A brand-new install has nothing to catch up on; an install that predates the button
      // (no mark yet) has just updated into it, and gets the dot.
      if (readSeen() === null && isFreshInstall()) writeSeen(s.current);
    }
    btn.toggleAttribute("data-new", readSeen() !== s.current);
  };

  // ── the panel's top: the version row, then What's new ──
  let checking = false;
  /** The version row (§9, his layout A): the version as the row's title, the status under it in
   *  its tone, the download bar under that while it downloads, and the one action on the right. */
  const versionRow = (s: UpdateStatus): string => {
    const words = checking ? { text: "Checking…", tone: "" } : updateStatusWords(s);
    let act = "";
    if (checking || s.state === "checking" || s.state === "downloading" || isDevBuild(s)) act = "";
    else if (offered(s) && s.state === "available")
      act = `<button class="set__half" type="button" data-uact="download" title="Downloads the update. Restart to install it">Download</button>`;
    else if (offered(s) && s.state === "ready")
      act = `<button class="set__half" type="button" data-uact="restart" title="Installs the update and opens DeetsMusic again">Restart</button>`;
    else if (s.state === "error")
      act = `<button class="set__half" type="button" data-uact="check" title="Asks music-api.deets.solutions for a newer version">Try again</button>`;
    else
      act = `<button class="set__half" type="button" data-uact="check" title="Asks music-api.deets.solutions for a newer version">Check now</button>`;
    const pct = s.size ? Math.min(1, s.got / s.size) : 0;
    const bar = s.state === "downloading" ? `<span class="updates__ver-bar" style="--updates-got: ${pct}"><span></span></span>` : "";
    return (
      `<div class="set__row updates__ver" data-uversion><span class="updates__ver-text">` +
      `<span class="updates__ver-name">DeetsMusic ${esc(s.current)}</span>` +
      `<span class="updates__ver-status"${words.tone ? ` data-tone="${words.tone}"` : ""}>${esc(words.text)}</span>${bar}</span>` +
      (act ? `<div class="set__split">${act}</div>` : "") +
      `</div>`
    );
  };
  /** What's new: the offered version's leads (what you will get), else the installed one's. */
  const notes = (s: UpdateStatus): { version: string; leads: string[] } =>
    offered(s) && s.notes != null ? { version: s.version!, leads: releaseLeads(s.notes) } : { version: built.version, leads: built.leads };
  let forceOpen = false; // F4 / the Compass: unfolded this once, whatever the fold memory says
  const whatsNew = (s: UpdateStatus): string => {
    const n = notes(s);
    const open = forceOpen || quickFoldOpen(NEW_FOLD);
    const inside = open
      ? (n.leads.length ? `<ul class="updates__leads">${n.leads.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "") +
        `<div class="updates__more"><button class="account__link" type="button" data-unotes title="Opens every version's notes on deets.solutions">All release notes</button></div>`
      : "";
    return (
      `<section class="set__section" data-ugroup>` +
      `<h3 class="set__head${open ? "" : " is-collapsed"}"><button class="set__fold" type="button" data-ufold aria-expanded="${open}" title="Click to open or close">` +
      `<svg class="lib-shelf__chev" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>` +
      `<span>What's new in ${esc(n.version)}</span>` +
      (n.leads.length ? `<span class="lib-shelf__count">${n.leads.length}</span>` : "") +
      `</button></h3>${inside}</section>`
    );
  };
  /** The status this button and panel show: the updater's, or a dev pretend one. */
  let cur: UpdateStatus | null = null;
  const renderTop = () => {
    const s = cur;
    top.innerHTML = s ? versionRow(s) + whatsNew(s) : "";
  };

  top.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>("[data-uact]")?.dataset.uact;
    if (act === "check") {
      checking = true;
      renderTop();
      void checkForUpdate(true).finally(() => {
        checking = false;
        renderTop();
      });
      return;
    }
    if (act === "download") return void download();
    if (act === "restart") return void restartNow();
    if (t.closest("[data-unotes]")) {
      void openUrl(NOTES_URL);
      return;
    }
    if (t.closest("[data-ufold]")) {
      const from = panel.offsetHeight;
      const open = forceOpen ? false : toggleQuickFold(NEW_FOLD);
      if (forceOpen) {
        // Folding the once-open group: the memory says folded already, so it stays folded.
        forceOpen = false;
        if (quickFoldOpen(NEW_FOLD)) toggleQuickFold(NEW_FOLD);
      }
      frames.during("fold", 250, open ? "open" : "close");
      renderTop();
      if (open) enterRows([...(top.querySelector("[data-ugroup]")?.children ?? [])].slice(1));
      animateHeight(from);
    }
  });

  // ── Bugs and suggestions: the Settings card's Bugs rows, one mount for the app's life, so a
  //    report being typed survives a close and an open. The version row is the panel's own. ──
  let bugs: CardInstance | null = null;
  const mountBugs = () => {
    bugs ??= mountSettingsParts(
      bugsHost,
      [{ title: "Bugs", except: ["version"], label: "Bugs and suggestions", fold: "updates:" }],
      (change) => {
        const from = panel.offsetHeight;
        change();
        animateHeight(from);
      },
    );
  };

  // ── follow the updater ──
  const onStatus = (s: UpdateStatus | null) => {
    cur = s;
    paintButton(s);
    paintNew(s);
    if (!panel.hidden) {
      const from = panel.offsetHeight;
      renderTop();
      animateHeight(from);
    }
  };
  onUpdateStatus(onStatus);
  onStatus(updateStatus());
  if (import.meta.env.DEV) {
    window.__updates = {
      fake: (state, got = 0.4) => {
        const real = updateStatus();
        const next = "0.29.0";
        onStatus({
          state, current: real?.current ?? built.version, channel: real?.channel ?? "deetsmusic",
          version: state === "idle" || state === "checking" || state === "error" ? null : next,
          notes: "**App updates in 2 seconds.** Text.\n\n**New App Icon.** Text.\n\n**Halved Press's record spin.** Text.\n\n**Fixes.** Text.",
          size: 1000, got: Math.round(got * 1000), rollback: false, error: null,
        });
      },
      real: () => onStatus(updateStatus()),
    };
  }

  dropdown = makeDropdown({
    root,
    trigger: btn,
    panel,
    // A Bugs row's menu (What went wrong) and the right-click menu are portaled to <body>.
    alsoInside: () => [...document.querySelectorAll(".set__menu:not([hidden]), .ctx-menu")],
    onOpen: () => {
      const s = cur;
      // F4: the first open in a new version shows What's new unfolded, once.
      if (s?.current && readSeen() !== s.current) {
        forceOpen = true;
        writeSeen(s.current);
        btn.removeAttribute("data-new");
      } else forceOpen = openWhatsNew;
      openWhatsNew = false;
      mountBugs();
      renderTop();
      keepRightInWindow(root, panel);
      enterRows([...top.children, ...(forceOpen ? top.querySelectorAll(".updates__leads, .updates__more") : []), ...bugsHost.querySelectorAll(".set__section > *")]);
      diag.log("updates:open", { state: s?.state ?? null, whatsNew: forceOpen });
    },
  });
  window.addEventListener("resize", () => { if (!panel.hidden) keepRightInWindow(root, panel); });
}
