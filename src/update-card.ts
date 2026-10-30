// The update card (docs/features/UPDATE-CARD.md): the grand opening's frame (paged-card.ts) with a
// page per version line, oldest first (his call 1). Each page: the line's release notes, then the
// settings it brought and the defaults it changed. Older (search every update since 1.0, §3.7)
// and Settings at the bar's foot. The last version page's button is *Done*.
//
// It never opens by itself (his call 10): the Updates panel does, and its *See the new settings*
// opens this; so does *What's New* in the Compass. Both show the last 3 lines (§3.7). The notes
// load with a dynamic import when it opens, so the launch does not carry them (§3.1).

import built from "virtual:release-notes";
import type { CardInstance } from "./cards";
import { openPagedCard, type PagedHandle, type PagedPage } from "./paged-card";
import { navNumber, settingsPage } from "./onboarding";
import { mountSettingsParts, newMarkEntries, seeNewMarks, settingsRows, quickFoldOpen, toggleQuickFold, type NewMarkEntry, type SettingsPart } from "./settings-card";
import { ownSetting, setSetting, DEFAULT_CHANGES, type DefaultChange, type Settings } from "./settings-store";
import { groupLines, lastLines, paragraphs, inlineHtml, inLine, searchUpdates, startLine, type Entry, type Line } from "./update-card-rules";
import { searchField } from "./search-field";
import { wireListKeys } from "./list-keys";
import { enterRows } from "./pop";
import * as diag from "./diag";

declare global {
  interface Window {
    /** Opens the update card (the Compass row, the Updates panel's button; a desk test's handle). */
    __updateCard?: { open: () => Promise<void> };
  }
}

/** The Older button's face: a clock with its hand turned back. */
const ICON_OLDER = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7v5l3 2"/></svg>';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** "2026-10-29" → "October 29, 2026", in the user's own words for dates. */
const dateText = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
};

/** The groups opened for the user once this session; after that, a fold here is theirs. */
const opened = new Set<string>();

// ── the notes column (§3.3, his call 6) ──────────────────────────────────────────

/** The line's notes: each release under its own heading, each paragraph with its lead in bold.
 *  When they do not fit the page's height, each paragraph shows as its lead only, and a lead
 *  opens its own paragraph under it. The fit is measured on mount and when the card resizes. */
function notesColumn(col: HTMLElement, line: Line, sheet: HTMLElement): () => void {
  const box = document.createElement("div");
  box.className = "uc__notes";
  box.innerHTML = [...line.entries]
    .map(
      (e) =>
        `<div class="set__head uc__release">${esc(e.version)} · ${esc(dateText(e.date))}</div>` +
        paragraphs(e.body)
          .map((p) =>
            p.shown
              ? `<p class="uc__para"><button class="uc__lead" type="button" aria-expanded="true" title="Shows or hides this change">${esc(p.shown)}</button> <span class="uc__text">${inlineHtml(p.text)}</span></p>`
              : `<p class="uc__para"><span class="uc__text">${inlineHtml(p.text)}</span></p>`,
          )
          .join(""),
    )
    .join("");
  col.append(box);

  const fit = () => {
    if (!box.isConnected) return;
    const was = box.dataset.compact === "true";
    box.dataset.compact = "false";
    const head = sheet.querySelector<HTMLElement>(".onboarding__hello");
    const room = sheet.clientHeight - (head?.offsetHeight ?? 0) - col.querySelector<HTMLElement>(".panel__title")!.offsetHeight;
    const compact = box.scrollHeight > room;
    box.dataset.compact = String(compact);
    for (const b of box.querySelectorAll<HTMLButtonElement>(".uc__lead")) {
      b.tabIndex = compact ? 0 : -1;
      const p = b.closest(".uc__para")!;
      if (compact !== was) p.classList.remove("is-open");
      b.setAttribute("aria-expanded", String(!compact || p.classList.contains("is-open")));
    }
  };
  box.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".uc__lead");
    if (!b || box.dataset.compact !== "true") return;
    const p = b.closest(".uc__para")!;
    const open = p.classList.toggle("is-open");
    b.setAttribute("aria-expanded", String(open));
    if (open) enterRows([p.querySelector(".uc__text")!]);
  });
  const watch = new ResizeObserver(() => fit());
  watch.observe(sheet);
  fit();
  return () => watch.disconnect();
}

// ── the settings column (§3.3, §3.4) ─────────────────────────────────────────────

/** The marks as Settings parts: a section mark is its whole section; row marks join their
 *  section's part, in the order they were added. */
function partsOf(marks: NewMarkEntry[], fold: string): SettingsPart[] {
  const parts: SettingsPart[] = [];
  for (const m of marks) {
    if (!m.row) {
      parts.push({ title: m.section, fold });
      continue;
    }
    const at = parts.find((p) => p.title === m.section && p.rows);
    if (at) at.rows!.push(m.row);
    else parts.push({ title: m.section, rows: [m.row], fold });
  }
  return parts;
}

/** A changed default's name for its new value: a choice's label, On or Off, or the value. */
function valueName(c: DefaultChange, options?: { value: string; label: string }[]): string {
  if (typeof c.to === "boolean") return c.to ? "On" : "Off";
  return options?.find((o) => o.value === String(c.to))?.label ?? String(c.to);
}

function settingsColumn(col: HTMLElement, line: Line): () => void {
  const marks = inLine(newMarkEntries(), line.line, built.version);
  // A changed default shows only while the user's own value is still the old one (§3.4, his
  // call 12): the app never changes it; *Use it* is the user's press.
  const offered = inLine(DEFAULT_CHANGES, line.line, built.version).filter(
    (c) => JSON.stringify(ownSetting(c.key)) === JSON.stringify(c.from),
  );
  const stops: (() => void)[] = [];
  if (!marks.length && !offered.length) {
    const p = document.createElement("p");
    p.className = "onboarding__body";
    p.textContent = "No new settings in this version.";
    col.append(p);
    return () => {};
  }
  const fold = `uc${line.line}`;
  if (marks.length) {
    const parts = partsOf(marks, fold);
    // A part's groups start folded in the quick panel; here they start open (the rows are the
    // point of the page), once a session, as on the grand opening's page 1.
    for (const p of parts) {
      const key = `${fold}${p.title}::`;
      if (opened.has(key)) continue;
      opened.add(key);
      if (!quickFoldOpen(key)) toggleQuickFold(key);
    }
    const host = document.createElement("div");
    col.append(host);
    const rows = mountSettingsParts(host, parts, "update");
    stops.push(() => rows.destroy());
    seeNewMarks(marks);
  }
  if (offered.length) {
    const head = document.createElement("div");
    head.className = "set__head uc__release";
    head.textContent = "New defaults";
    col.append(head);
    const entries = settingsRows();
    for (const c of offered) {
      const entry = entries.find((r) => r.key === c.key);
      if (!entry) continue;
      const host = document.createElement("div");
      col.append(host);
      const rows = mountSettingsParts(host, [{ title: entry.section, rows: [entry.id], bare: true }], "update");
      stops.push(() => rows.destroy());
      const offer = document.createElement("div");
      offer.className = "set__row uc__offer";
      offer.innerHTML =
        `<span class="set__label">New default: <strong>${esc(valueName(c, entry.options))}</strong>. ${esc(c.why)}</span>` +
        `<div class="set__split"><button class="set__half" type="button" title="Sets this to the new default. You can change it back in Settings">Use it</button></div>`;
      offer.querySelector("button")!.addEventListener("click", () => {
        setSetting(c.key, c.to as Settings[typeof c.key], "update");
        diag.log("updatecard:useDefault", { key: c.key });
        offer.remove();
      });
      col.append(offer);
    }
  }
  return () => stops.forEach((f) => f());
}

// ── a version page ───────────────────────────────────────────────────────────────

/** One line's page: the line and its dates on top, then the notes and the settings. No previews
 *  column yet: each preview is designed with him, row by row (§3.6). */
function mountVersion(el: HTMLElement, line: Line, back?: () => void): CardInstance {
  const first = line.entries[0];
  const last = line.entries[line.entries.length - 1];
  const dates = first === last ? dateText(first.date) : `${dateText(first.date)} to ${dateText(last.date)}`;
  el.innerHTML =
    `<div class="onboarding__sheet app-scroll">` +
    `<header class="onboarding__hello">` +
    (back ? `<button class="panel__back uc__back" type="button" aria-label="Back" title="Goes back to the search"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : "") +
    `<h1 class="onboarding__hi">${esc(line.line)}</h1><p class="onboarding__sub">${esc(dates)}</p></header>` +
    `<div class="onboarding__cols onboarding__cols--two">` +
    `<section class="onboarding__col" data-col="notes"><h2 class="panel__title">What's new</h2></section>` +
    `<section class="onboarding__col" data-col="settings"><h2 class="panel__title">New settings</h2></section>` +
    `</div></div>`;
  if (back) el.querySelector(".uc__back")!.addEventListener("click", back);
  const sheet = el.querySelector<HTMLElement>(".onboarding__sheet")!;
  const stopNotes = notesColumn(el.querySelector('[data-col="notes"]')!, line, sheet);
  const stopSettings = settingsColumn(el.querySelector('[data-col="settings"]')!, line);
  return {
    destroy() {
      stopNotes();
      stopSettings();
      el.replaceChildren();
    },
  };
}

// ── Older: search every update since 1.0 (§3.7) ─────────────────────────────────

function mountOlder(el: HTMLElement, lines: Line[], inNav: Set<string>, handle: () => PagedHandle | null): CardInstance {
  let inner: CardInstance | null = null;
  let term = "";
  const names = newMarkEntries().map((m) => ({ since: m.since, label: m.label }));
  const list = () => {
    inner?.destroy();
    inner = null;
    el.innerHTML =
      `<div class="onboarding__sheet app-scroll">` +
      `<header class="onboarding__hello"><h1 class="onboarding__hi">Older updates</h1>` +
      `<p class="onboarding__sub">Every update since 1.0. Search the notes and the settings' names</p></header>` +
      `<label class="lib-search uc__search"><svg class="lib-search__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>` +
      `<input class="lib-search__input" type="search" placeholder="Search updates…" autocomplete="off" spellcheck="false" /></label>` +
      `<div class="uc__hits" role="list"></div></div>`;
    const input = el.querySelector<HTMLInputElement>("input")!;
    const hits = el.querySelector<HTMLElement>(".uc__hits")!;
    const paint = () => {
      const found = searchUpdates(term, lines, names);
      // No words: every version, newest first, as a list to open.
      const rows = term
        ? found.map((h) => ({ line: h.line, top: h.text, sub: `${h.version} · ${h.kind === "setting" ? "a new setting" : "a change"}` }))
        : [...lines].reverse().map((l) => ({ line: l.line, top: l.line, sub: dateText(l.entries[l.entries.length - 1].date) }));
      hits.innerHTML = rows.length
        ? rows.map((r) => `<button class="uc__hit" type="button" role="listitem" data-line="${esc(r.line)}" title="Opens this version"><span class="uc__hit-top">${esc(r.top)}</span><span class="uc__hit-sub">${esc(r.sub)}</span></button>`).join("")
        : `<p class="onboarding__body">Nothing found.</p>`;
    };
    hits.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-line]");
      if (b) openLine(b.dataset.line!);
    });
    const stopKeys = wireListKeys(hits, { rows: ".uc__hit" });
    const field = searchField(input, { onTerm: (t) => ((term = t), paint()), first: () => hits.querySelector<HTMLElement>(".uc__hit") });
    if (term) field.set(term);
    else paint();
    stop = () => {
      stopKeys();
      field.destroy();
    };
  };
  /** A line in the nav bar opens as its page; an older one opens here, with Back to the list. */
  const openLine = (l: string) => {
    diag.log("updatecard:older", { line: l });
    if (inNav.has(l)) return handle()?.show(`v${l}`);
    const line = lines.find((x) => x.line === l);
    if (!line) return;
    stop();
    inner = mountVersion(el, line, list);
  };
  let stop = () => {};
  list();
  return {
    destroy() {
      stop();
      inner?.destroy();
      el.replaceChildren();
    },
  };
}

// ── open ─────────────────────────────────────────────────────────────────────────

let handle: PagedHandle | null = null;

/** The version the app ran before the last update, and the version the card was last opened in
 *  (his call 13): the page it opens on. Per-install marks, like `deets.updates.lastRun`. */
const BEFORE_KEY = "deets.updates.before";
const CARD_SEEN_KEY = "deets.updates.cardSeen";
const readMark = (k: string): string => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const writeMark = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: the card opens on the newest version */
  }
};
/** updates-btn.ts, at a launch after an update: the version the user ran before it. */
export const notePreviousRun = (v: string): void => writeMark(BEFORE_KEY, v);

/** Opens the update card on the last 3 version lines, oldest first, on the first version the
 *  user has not run yet (the newest when nothing is new; `startLine`). Resolves when it closes. */
export async function openUpdateCard(): Promise<void> {
  if (handle) return handle.done;
  const { default: entries } = (await import("virtual:release-entries")) as { default: Entry[] };
  const lines = groupLines(entries);
  const shown = lastLines(lines, 3);
  if (!shown.length) return;
  const start = startLine(shown, readMark(BEFORE_KEY), readMark(CARD_SEEN_KEY) === built.version);
  writeMark(CARD_SEEN_KEY, built.version);
  const inNav = new Set(shown.map((l) => l.line));
  const pages: PagedPage[] = shown.map((l, i) => ({
    id: `v${l.line}`,
    face: navNumber(l.line),
    label: `Version ${l.line}`,
    hint: `Shows what changed in ${l.line}`,
    forward: i === shown.length - 1 ? { label: "Done", hint: "Closes this page", end: true } : { label: "Next", hint: "Shows the next version" },
    mount: (el) => mountVersion(el, l),
  }));
  pages.push({ id: "older", face: ICON_OLDER, label: "Older updates", hint: "Searches every update since 1.0", foot: true, mount: (el) => mountOlder(el, lines, inNav, () => handle) });
  pages.push(settingsPage());
  diag.log("updatecard:start", { start });
  handle = openPagedCard({ name: "updatecard", ariaLabel: "What's new in DeetsMusic", pages, start: start && `v${start}`, onClosed: () => (handle = null) });
  return handle?.done;
}

window.__updateCard = { open: openUpdateCard };
