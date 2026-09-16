// The Sound panel (SOUND.md §2.3–2.4): the title bar's EQ-fader icon and its dropdown.
// The equalizer (a curve with a handle per band, or ten faders), presets, DeetsAdaptiveSound's
// three parts, and — per the user's rule — every decision's status line, its "How it decides"
// fold and the settings that change it. The panel only writes settings and calls sound.ts;
// sound.ts is the one reader.

import { makeDropdown } from "./dropdown";
import { enterRows } from "./pop";
import { makeSlider, type SliderHandle } from "./slider";
import { setting, setSetting, onSettingsChange, type Settings } from "./settings-store";
import { bandBiquads, chainDb, logFreqs, lowVolumeShelves, rbj, type Band, type BandType } from "./sound-dsp";
import { GRAPHIC_FREQS, MAX_BANDS, fitGraphic, isGraphic, parseApo, toApo, type EqPreset } from "./sound-presets";
import * as sound from "./sound";
import { getVolume, getDuck, onPlayerState } from "./player";
import * as diag from "./diag";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── Geometry of the plot ────────────────────────────────────────────────────────────
const F_LO = 20, F_HI = 20000;
const DB_RANGE = 12; // ± dB shown
const PLOT_W = 300, PLOT_H = 120; // SVG user units; the SVG stretches to the panel
const xOf = (f: number) => Math.log(f / F_LO) / Math.log(F_HI / F_LO);
const fOf = (x: number) => F_LO * Math.pow(F_HI / F_LO, Math.max(0, Math.min(1, x)));
const yOf = (db: number) => 0.5 - Math.max(-DB_RANGE, Math.min(DB_RANGE, db)) / (2 * DB_RANGE);
const dbOf = (y: number) => (0.5 - y) * 2 * DB_RANGE;
const CURVE_FREQS = logFreqs(160);

/** The five plain-language zones (SOUND.md §2.5): what a listener calls each part of the range. */
const ZONES = [
  { id: "bass", label: "Bass", lo: 20, hi: 150, words: "the bass", hint: "Bass, 20–150 Hz: the kick drum and the bass guitar. Raise it for weight; lower it if the sound booms" },
  { id: "body", label: "Body", lo: 150, hi: 500, words: "the low mids", hint: "Body, 150–500 Hz: the warmth of guitars, piano and voices. Too much sounds muddy; too little sounds thin" },
  { id: "voice", label: "Voice", lo: 500, hi: 2500, words: "the voice range", hint: "Voice, 500 Hz–2.5 kHz: where singing and most instruments sit. Raise it to bring vocals forward" },
  { id: "detail", label: "Detail", lo: 2500, hi: 8000, words: "the detail", hint: "Detail, 2.5–8 kHz: consonants, the snap of a snare, the bite of a guitar. Raise it for clarity; lower it if it sounds harsh" },
  { id: "air", label: "Air", lo: 8000, hi: 20000, words: "the top end", hint: "Air, 8–20 kHz: cymbals, breath and sparkle. Raise it for openness; lower it if it hisses" },
] as const;

/** The song's shape: 96 log-spaced bands, averaged over the song (not a flickering live view). */
const SHAPE_FREQS = logFreqs(96);
/** Most mixes fall about 4.5 dB per octave; the shape and the reading are drawn against that
 *  slope, so a balanced song looks level instead of sliding down to the right. */
const SHAPE_SLOPE_DB_PER_OCT = 4.5;
const SHAPE_RANGE_DB = 48; // the silhouette's height in dB
const SHAPE_MIN_FRAMES = 30; // 3 s of sound before the reading speaks

const TYPES: { type: BandType; label: string }[] = [
  { type: "peak", label: "Peak" },
  { type: "lowshelf", label: "Low shelf" },
  { type: "highshelf", label: "High shelf" },
  { type: "highpass", label: "Low cut" },
  { type: "lowpass", label: "High cut" },
  { type: "notch", label: "Notch" },
];
const hasGain = (t: BandType) => t === "peak" || t === "lowshelf" || t === "highshelf";

const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
const db = (v: number, digits = 1) => `${v > 0.049 ? "+" : v < -0.049 ? "−" : ""}${Math.abs(v).toFixed(digits)} dB`;
const pct = (v: number) => `${Math.round(v * 100)} %`;
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// ── The icon: three faders whose knobs sit at the curve's low / mid / high ─────────────
function icon(bands: Band[], on: boolean): string {
  const fs = sound.sampleRateNow();
  const chain = on ? bands.flatMap((b) => bandBiquads(b, fs, "matched")) : [];
  const knob = (f: number) => 12 - Math.max(-6, Math.min(6, chain.length ? chainDb(chain, f, fs) : 0)) * 1.1;
  const [a, b, c] = [100, 1000, 8000].map(knob);
  return (
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M6 3v18M12 3v18M18 3v18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.55"/>' +
    `<rect x="3.5" y="${(a - 2).toFixed(1)}" width="5" height="4" rx="1.4" fill="currentColor"/>` +
    `<rect x="9.5" y="${(b - 2).toFixed(1)}" width="5" height="4" rx="1.4" fill="currentColor"/>` +
    `<rect x="15.5" y="${(c - 2).toFixed(1)}" width="5" height="4" rx="1.4" fill="currentColor"/>` +
    "</svg>"
  );
}

// ── Small builders ──────────────────────────────────────────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function pill(title: string): HTMLButtonElement {
  const b = el("button", "sound__pill");
  b.type = "button";
  b.title = title;
  return b;
}
function row(label: string, control: HTMLElement, cls = ""): HTMLDivElement {
  const r = el("div", `sound__row ${cls}`.trim());
  r.append(el("span", "sound__label", label), control);
  return r;
}
/** A pill that cycles `values` for a store key, showing `labels`. */
function cyclePill<K extends keyof Settings>(key: K, values: Settings[K][], labels: string[], title: string): { btn: HTMLButtonElement; sync: () => void } {
  const btn = pill(title);
  const sync = () => {
    const i = values.indexOf(setting(key));
    btn.textContent = labels[i < 0 ? 0 : i];
    const v = setting(key) as unknown;
    btn.setAttribute("aria-pressed", String(v !== false && v !== "off" && v !== "none" && v !== 0));
  };
  btn.addEventListener("click", () => {
    const i = values.indexOf(setting(key));
    setSetting(key, values[(i + 1) % values.length]);
  });
  return { btn, sync };
}

// ── The panel ───────────────────────────────────────────────────────────────────────

interface Parts {
  btn: HTMLButtonElement;
  panel: HTMLElement;
}

let parts: Parts | null = null;
let selected = -1; // the band being edited (parametric)
let dragging = false;
let live: Band[] | null = null; // bands during a drag, before the commit
const syncs: (() => void)[] = [];

/** The bands on screen. While the equalizer is off it shows Flat (user, 2026-09-16); turning it
 *  on brings the picked preset back, and moving a slider starts Custom from flat. */
function bands(): Band[] {
  if (live) return live;
  return setting("soundEq") ? sound.activePreset().bands : [];
}
function shownName(): string {
  return setting("soundEq") ? sound.activePreset().name : "Flat";
}

let overVolume = false;
function volumeControls(): Element[] {
  return [document.getElementById("vol"), ...document.querySelectorAll(".np__vol")].filter((e): e is Element => !!e);
}

export function initSoundPanel(): void {
  document.addEventListener("pointerover", (e) => {
    overVolume = volumeControls().some((v) => v.contains(e.target as Node));
  });
  const root = $("sound");
  const btn = $<HTMLButtonElement>("sound-btn");
  const panel = $("sound-panel");
  if (!root || !btn || !panel) return;
  parts = { btn, panel };
  panel.classList.add("app-scroll"); // the app's own scrollbar, not the OS bar (UI-ARCHITECTURE §Scrollbars)
  build(panel);
  panel.dataset.frames = "sound";
  makeDropdown({
    root,
    trigger: btn,
    panel,
    // Turning the volume (the title bar pill, the Now Playing row) is part of listening to the
    // effect (Fuller at low volume follows it): a click there, or a hover-mode move onto it,
    // keeps the panel open.
    shouldStayOpen: (why) => dragging || holding || (why === "leave" && overVolume),
    alsoInside: volumeControls,
    onOpen: () => {
      enterRows([head, ...visibleRows(tab === "eq" ? eqView : adaptView), footer]);
      void startShape();
      renderAll();
    },
  });
  // The dropdown hides the panel; stop reading the song's shape then (a MutationObserver on `hidden`).
  new MutationObserver(() => {
    if (panel.hidden) stopShape();
  }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  onSettingsChange((k) => {
    if (String(k).startsWith("sound")) renderAll();
  });
  sound.onSoundChange(() => {
    if (!panel.hidden) renderStatus();
    renderIcon();
  });
  // A new song starts a new shape.
  let songKey = "";
  onPlayerState((st) => {
    const key = `${st.title ?? ""}\u0000${st.artist ?? ""}`;
    if (key === songKey) return;
    songKey = key;
    resetShape();
  });
  renderAll();
}

// References filled by build()
let plot!: SVGSVGElement;
let curvePath!: SVGPathElement;
let fillPath!: SVGPathElement;
let eqView!: HTMLDivElement;
let adaptView!: HTMLDivElement;
let footer!: HTMLDivElement;
let tabEq!: HTMLButtonElement;
let tabAdapt!: HTMLButtonElement;
let tab: "eq" | "adapt" = "eq";
let head!: HTMLDivElement;
let resetBtn!: HTMLButtonElement;
let reviewPill!: HTMLButtonElement;
let songPath!: SVGPathElement;
let heardPath!: SVGPathElement;
let zoneRects: SVGRectElement[] = [];
let infoBtn!: HTMLButtonElement;
let infoBody!: HTMLDivElement;
let listening: string | null = null;
let handles!: HTMLDivElement;
let faders!: HTMLDivElement;
let faderHandles: { el: HTMLElement; slider: SliderHandle }[] = [];
let graph!: HTMLDivElement;
let bandRow!: HTMLDivElement;
let bandType!: HTMLButtonElement;
let bandReadout!: HTMLSpanElement;
let bandOn!: HTMLButtonElement;
let presetName!: HTMLSpanElement;
let modePill!: HTMLButtonElement;
let eqPill!: HTMLButtonElement;
let eqStatus!: HTMLDivElement;
let eqNote!: HTMLDivElement;
let eqFoldBody!: HTMLDivElement;
let eqWhy!: HTMLDivElement;
let outputsList!: HTMLDivElement;
let actionsRow!: HTMLDivElement;
let nameRow!: HTMLDivElement;
let nameInput!: HTMLInputElement;
let deleteBtn!: HTMLButtonElement;
let renameBtn!: HTMLButtonElement;
let preampRow!: HTMLDivElement;
let preampValue!: HTMLSpanElement;
let adaptivePill!: HTMLButtonElement;
let loudStatus!: HTMLDivElement;
let lowStatus!: HTMLDivElement;
let xfStatus!: HTMLDivElement;
let adaptFoldBody!: HTMLDivElement;
let adaptWhy!: HTMLDivElement;
let reviewStatus!: HTMLSpanElement;
let reviewActions!: HTMLDivElement;
let meter!: HTMLSpanElement;
let compareBtn!: HTMLButtonElement;
let holding = false;
let nameMode: "save" | "rename" = "save";
let deleteArmed = false;

const SVG = "http://www.w3.org/2000/svg";

function build(panel: HTMLElement): void {
  panel.replaceChildren();

  // 1. Head: the title, the two tabs, i and Compare
  head = el("div", "sound__head");
  eqView = el("div", "sound__view");
  adaptView = el("div", "sound__view");
  footer = el("div", "sound__footer");
  compareBtn = el("button", "sound__compare", "Compare");
  compareBtn.type = "button";
  compareBtn.title = "Hold to hear the music without the effects, at the same loudness";
  const hold = (on: boolean) => {
    if (holding === on) return;
    holding = on;
    compareBtn.toggleAttribute("data-held", on);
    sound.setCompare(on);
    diag.log("sound:compare", { on });
  };
  compareBtn.addEventListener("pointerdown", (e) => {
    compareBtn.setPointerCapture(e.pointerId);
    hold(true);
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => compareBtn.addEventListener(t, () => hold(false)));
  compareBtn.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      hold(true);
    }
  });
  compareBtn.addEventListener("keyup", () => hold(false));
  infoBtn = el("button", "panel__action sound__info");
  infoBtn.type = "button";
  infoBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>';
  infoBtn.setAttribute("aria-label", "About this song's sound");
  infoBtn.title = "What this song's sound is like. Click for the numbers";
  infoBtn.setAttribute("aria-expanded", "false");
  infoBtn.addEventListener("click", () => {
    const open = infoBody.hidden;
    showPart(infoBody, open);
    infoBtn.setAttribute("aria-expanded", String(open));
    renderReading();
  });
  const tabs = el("div", "sound__tabs");
  tabs.setAttribute("role", "tablist");
  tabEq = el("button", "sound__tab", "Equalizer");
  tabAdapt = el("button", "sound__tab", "Adaptive");
  [tabEq, tabAdapt].forEach((t) => {
    t.type = "button";
    t.setAttribute("role", "tab");
  });
  tabEq.title = "The equalizer: the curve, the sliders and the presets";
  tabAdapt.title = "Adaptive sound: matched loudness, fuller low volume and headphone crossfeed";
  tabEq.addEventListener("click", () => setTab("eq"));
  tabAdapt.addEventListener("click", () => setTab("adapt"));
  tabs.append(tabEq, tabAdapt);
  const headEnd = el("div", "sound__head-end");
  headEnd.append(infoBtn, compareBtn);
  head.append(el("span", "sound__title", "Sound"), tabs, headEnd);
  panel.append(head);
  infoBody = el("div", "sound__fold sound__info-body");
  infoBody.hidden = true;
  panel.append(infoBody);

  // 2. Equalizer on/off
  eqPill = pill("Turns the equalizer on or off");
  eqPill.addEventListener("click", () => setSetting("soundEq", !setting("soundEq")));
  resetBtn = el("button", "sound__chip", "Reset");
  resetBtn.type = "button";
  resetBtn.title = "Puts every band back to 0 dB (the Flat preset). Undo is offered for a moment";
  resetBtn.addEventListener("click", () => (undoReset ? undoReset() : resetToFlat()));
  const eqEnd = el("div", "sound__row-end");
  eqEnd.append(resetBtn, eqPill);
  eqView.append(row("Equalizer", eqEnd, "sound__row--strong"));

  // 3. The graph: zones, grid, the song's shape and what you hear, the EQ curve; dots or faders on top
  graph = el("div", "sound__graph");
  plot = document.createElementNS(SVG, "svg");
  plot.setAttribute("class", "sound__plot");
  plot.setAttribute("viewBox", `0 0 ${PLOT_W} ${PLOT_H}`);
  plot.setAttribute("preserveAspectRatio", "none");
  plot.setAttribute("aria-hidden", "true");
  const grid = document.createElementNS(SVG, "path");
  grid.setAttribute("class", "sound__grid");
  let g = "";
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) g += `M${(xOf(f) * PLOT_W).toFixed(1)} 0V${PLOT_H}`;
  for (const d of [-6, 6]) g += `M0 ${(yOf(d) * PLOT_H).toFixed(1)}H${PLOT_W}`;
  grid.setAttribute("d", g);
  const zero = document.createElementNS(SVG, "path");
  zero.setAttribute("class", "sound__zero");
  zero.setAttribute("d", `M0 ${PLOT_H / 2}H${PLOT_W}`);
  const zoneGroup = document.createElementNS(SVG, "g");
  zoneRects = ZONES.map((z, i) => {
    const r = document.createElementNS(SVG, "rect");
    r.setAttribute("class", `sound__zone${i % 2 ? " sound__zone--alt" : ""}`);
    r.setAttribute("x", (xOf(z.lo) * PLOT_W).toFixed(1));
    r.setAttribute("width", ((xOf(z.hi) - xOf(z.lo)) * PLOT_W).toFixed(1));
    r.setAttribute("y", "0");
    r.setAttribute("height", String(PLOT_H));
    zoneGroup.append(r);
    return r;
  });
  songPath = document.createElementNS(SVG, "path");
  songPath.setAttribute("class", "sound__song");
  heardPath = document.createElementNS(SVG, "path");
  heardPath.setAttribute("class", "sound__heard");
  fillPath = document.createElementNS(SVG, "path");
  fillPath.setAttribute("class", "sound__fill");
  curvePath = document.createElementNS(SVG, "path");
  curvePath.setAttribute("class", "sound__curve");
  plot.append(zoneGroup, grid, songPath, heardPath, zero, fillPath, curvePath);
  handles = el("div", "sound__handles");
  faders = el("div", "sound__faders");
  graph.append(plot, handles, faders);
  graph.title = "Click the curve to add a band. Drag a dot to move it; roll the wheel on a dot to widen or narrow it";
  wireGraph();
  buildFaders();
  const axis = el("div", "sound__zones");
  ZONES.forEach((z, i) => {
    const b = el("button", "sound__zone-btn", z.label);
    b.type = "button";
    b.title = `${z.hint}. Hold to hear only this range`;
    b.style.setProperty("--lo", String(xOf(z.lo)));
    b.style.setProperty("--hi", String(xOf(z.hi)));
    const lit = (on: boolean) => zoneRects[i].toggleAttribute("data-lit", on);
    b.addEventListener("pointerenter", () => lit(true));
    b.addEventListener("pointerleave", () => lit(false));
    const listen = (on: boolean) => {
      if (listening === (on ? z.id : null)) return;
      listening = on ? z.id : null;
      b.toggleAttribute("data-held", on);
      lit(on);
      sound.setSolo(on ? { lo: z.lo, hi: z.hi } : null);
    };
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      b.setPointerCapture(e.pointerId);
      listen(true);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => b.addEventListener(t, () => listen(false)));
    b.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        listen(true);
      }
    });
    b.addEventListener("keyup", () => listen(false));
    axis.append(b);
  });
  const ends = el("div", "sound__ends");
  const legend = el("span", "sound__legend");
  const song = el("span", "sound__key sound__key--song", "This song");
  song.title = "The song's own shape, averaged while it plays";
  const heard = el("span", "sound__key sound__key--heard", "What you hear");
  heard.title = "The song's shape with your equalizer and adaptive sound applied";
  legend.append(song, heard);
  ends.append(el("span", "", "20 Hz"), legend, el("span", "", "20 kHz"));
  const graphWrap = el("div", "sound__graph-wrap");
  graphWrap.append(graph, axis, ends);
  eqView.append(graphWrap);

  // 4. The selected band
  bandRow = el("div", "sound__band");
  bandType = pill("The band's shape. Click for the next one");
  bandType.addEventListener("click", () => editBand((b) => {
    const i = TYPES.findIndex((t) => t.type === b.type);
    const next = TYPES[(i + 1) % TYPES.length].type;
    b.type = next;
    if (!hasGain(next)) b.gain = 0;
    if (next === "lowshelf" || next === "highshelf" || next === "lowpass" || next === "highpass") b.q = 0.707;
  }));
  bandReadout = el("span", "sound__readout");
  bandOn = pill("Turns this band on or off without losing it");
  bandOn.addEventListener("click", () => editBand((b) => (b.on = !b.on)));
  const del = el("button", "sound__icon-btn", "×");
  del.type = "button";
  del.title = "Removes this band";
  del.setAttribute("aria-label", "Remove band");
  del.addEventListener("click", () => removeBand(selected));
  bandRow.append(bandType, bandReadout, bandOn, del);
  eqView.append(bandRow);

  // 5. Presets: ‹ name ›, mode, the actions menu
  const presetRow = el("div", "sound__presets");
  const prev = el("button", "sound__step", "‹");
  prev.type = "button";
  prev.title = "The previous preset";
  prev.setAttribute("aria-label", "Previous preset");
  const next = el("button", "sound__step", "›");
  next.type = "button";
  next.title = "The next preset";
  next.setAttribute("aria-label", "Next preset");
  presetName = el("span", "sound__preset-name");
  const walk = (dir: number) => {
    const list = sound.presetOptions();
    // While off the screen shows Flat, so the step starts from Flat, and the pick turns it on.
    const from = setting("soundEq") ? setting("soundEqPreset") : "flat";
    const i = list.findIndex((p) => p.id === from);
    selected = -1;
    sound.selectPreset(list[(i + dir + list.length) % list.length].id);
    if (!setting("soundEq")) setSetting("soundEq", true);
  };
  prev.addEventListener("click", () => walk(-1));
  next.addEventListener("click", () => walk(1));
  // A preset picked while the equalizer is off turns it on: picking one is asking to hear it.
  modePill = pill("Sliders: ten fixed sliders, one per range. Dots: a dot per band on the curve, free to move");
  modePill.addEventListener("click", () => setMode(setting("soundEqMode") === "graphic" ? "parametric" : "graphic"));
  const more = el("button", "sound__icon-btn", "⋯");
  more.type = "button";
  more.title = "Save, rename, delete, import or copy the preset";
  more.setAttribute("aria-label", "Preset actions");
  more.setAttribute("aria-expanded", "false");
  more.addEventListener("click", () => {
    const open = actionsRow.hidden;
    showPart(actionsRow, open);
    more.setAttribute("aria-expanded", String(open));
    if (!open) showPart(nameRow, false);
  });
  presetRow.append(prev, presetName, next, modePill, more);
  eqView.append(presetRow);

  actionsRow = el("div", "sound__actions");
  const action = (label: string, title: string, run: () => void) => {
    const b = el("button", "sound__chip", label);
    b.type = "button";
    b.title = title;
    b.addEventListener("click", run);
    actionsRow.append(b);
    return b;
  };
  action("Save as", "Saves the curve under a new name", () => askName("save"));
  renameBtn = action("Rename", "Renames this saved preset", () => askName("rename"));
  deleteBtn = action("Delete", "Deletes this saved preset. Click twice", () => deletePreset());
  action("Import", "Reads an Equalizer APO or AutoEq text file (Preamp and Filter lines)", () => importFile());
  action("Paste", "Reads Equalizer APO or AutoEq text from the clipboard", () => void pasteText());
  action("Copy", "Copies the preset as Equalizer APO text", () => void copyText());
  actionsRow.hidden = true;
  eqView.append(actionsRow);

  nameRow = el("div", "sound__name");
  nameInput = el("input", "sound__input");
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.placeholder = "Preset name";
  const ok = el("button", "sound__chip", "OK");
  ok.type = "button";
  ok.title = "Saves the name";
  ok.addEventListener("click", () => commitName());
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commitName();
    if (e.key === "Escape") showPart(nameRow, false);
    e.stopPropagation();
  });
  nameRow.append(nameInput, ok);
  nameRow.hidden = true;
  eqView.append(nameRow);

  eqStatus = el("div", "sound__status");
  eqNote = el("div", "sound__note");
  eqNote.hidden = true;
  eqView.append(eqStatus, eqNote);

  // The EQ's fold: how it decides, and its settings
  const eqFold = foldButton("How the equalizer decides", "Shows what the equalizer uses and the settings that change it", () => eqFoldBody);
  eqView.append(eqFold);
  eqFoldBody = el("div", "sound__fold");
  eqWhy = el("div", "sound__why");
  const autoPre = cyclePill(
    "soundEqPreamp",
    ["limiter", "needed", "always", "manual"],
    ["Limiter only", "When needed", "Always", "Set by hand"],
    "How a boost is kept from clipping: the limiter alone, lower the song only when the volume leaves no room, always lower it by the boost, or a level you set",
  );
  syncs.push(autoPre.sync);
  preampValue = el("span", "sound__readout");
  const preDown = el("button", "sound__step", "‹");
  preDown.type = "button";
  preDown.title = "0.5 dB lower";
  preDown.setAttribute("aria-label", "Preamp 0.5 dB lower");
  const preUp = el("button", "sound__step", "›");
  preUp.type = "button";
  preUp.title = "0.5 dB higher";
  preUp.setAttribute("aria-label", "Preamp 0.5 dB higher");
  const nudge = (d: number) => setSetting("soundEqPreampDb", Math.max(-24, Math.min(6, Math.round((setting("soundEqPreampDb") + d) * 2) / 2)));
  preDown.addEventListener("click", () => nudge(-0.5));
  preUp.addEventListener("click", () => nudge(0.5));
  const preCtl = el("div", "sound__stepper");
  preCtl.append(preDown, preampValue, preUp);
  preampRow = row("Preamp level", preCtl);
  const perOut = cyclePill("soundEqPerOutput", [true, false], ["On", "Off"], "On: each output remembers its own preset, and switching output switches the preset");
  syncs.push(perOut.sync);
  outputsList = el("div", "sound__outputs");
  // The settings first, then what they do (user, 2026-09-16): the controls never move when the text changes.
  eqFoldBody.append(row("Preamp", autoPre.btn), preampRow, row("Per output", perOut.btn), outputsList, eqWhy);
  eqFoldBody.hidden = true;
  eqView.append(eqFoldBody);

  // 6. DeetsAdaptiveSound
  adaptivePill = pill("Turns adaptive sound on or off: matched loudness, fuller low volume and headphone crossfeed");
  adaptivePill.addEventListener("click", () => setSetting("soundAdaptive", !setting("soundAdaptive")));
  adaptView.append(row("Adaptive sound", adaptivePill, "sound__row--strong"));

  const loud = cyclePill("soundLoudness", [true, false], ["On", "Off"], "Plays each song at the same loudness");
  syncs.push(loud.sync);
  loudStatus = el("div", "sound__status");
  adaptView.append(partRow("Match loudness", loudStatus, loud.btn));

  const low = cyclePill("soundLowVol", ["off", "gentle", "full"], ["Off", "Gentle", "Full"], "Adds bass and a little treble as the volume goes down, the way the ear loses them");
  syncs.push(low.sync);
  lowStatus = el("div", "sound__status");
  adaptView.append(partRow("Fuller at low volume", lowStatus, low.btn));

  const xf = cyclePill("soundCrossfeed", ["auto", "always", "off"], ["Auto", "Always", "Off"], "Mixes a little of each channel into the other on headphones. Auto: only when Windows reports headphones");
  syncs.push(xf.sync);
  xfStatus = el("div", "sound__status");
  adaptView.append(partRow("Headphone crossfeed", xfStatus, xf.btn));

  adaptView.append(foldButton("How adaptive sound decides", "Shows what each part follows and the settings that change it", () => adaptFoldBody));
  adaptFoldBody = el("div", "sound__fold");
  adaptWhy = el("div", "sound__why");
  const target = cyclePill("soundLoudTarget", [-16, -14, -18], ["−16 LUFS", "−14 LUFS", "−18 LUFS"], "How loud every song is made: −16 is Apple's Sound Check level, −14 is louder, −18 is quieter");
  const album = cyclePill("soundLoudAlbum", [true, false], ["On", "Off"], "On: an album played in order keeps one gain, so its quiet songs stay quiet");
  const unmeasured = cyclePill("soundLoudUnmeasured", ["median", "none"], ["Median", "No change"], "A song not measured yet: the library's median gain, or no change");
  const key = cyclePill("soundLowVolKey", ["both", "app"], ["App × Windows", "App only"], "Which volume Fuller at low volume follows");
  const level = cyclePill("soundCrossfeedLevel", ["medium", "strong", "light"], ["Medium", "Strong", "Light"], "How much of each channel goes into the other");
  syncs.push(target.sync, album.sync, unmeasured.sync, key.sync, level.sync);
  adaptFoldBody.append(
    row("Loudness target", target.btn),
    row("Album gain", album.btn),
    row("New songs", unmeasured.btn),
    row("Low volume follows", key.btn),
    row("Crossfeed amount", level.btn),
    adaptWhy,
  );
  adaptFoldBody.hidden = true;
  adaptView.append(adaptFoldBody);

  // 7. The review and the meter
  const review = cyclePill("soundReviewDays", [7, 14, 3, 0], ["7 days", "14 days", "3 days", "Never"], "When to ask whether the effects are worth keeping, counted from the first time one was turned on");
  syncs.push(review.sync);
  reviewStatus = el("span", "sound__foot-text");
  review.btn.classList.add("sound__foot-pill");
  review.btn.title = "When to ask whether the effects are worth keeping, counted from the first time one was turned on. Click for the next choice";
  reviewActions = el("div", "sound__actions");
  const keep = el("button", "sound__chip", "Keep");
  keep.type = "button";
  keep.title = "Keeps the effects and stops asking";
  keep.addEventListener("click", () => setSetting("soundReviewed", true));
  const off = el("button", "sound__chip", "Turn all off");
  off.type = "button";
  off.title = "Turns the equalizer and adaptive sound off";
  off.addEventListener("click", () => {
    setSetting("soundEq", false);
    setSetting("soundAdaptive", false);
  });
  reviewActions.append(keep, off);
  reviewActions.hidden = true;
  meter = el("span", "sound__meter");
  meter.title = "The limiter's deepest cut and the loudest sample in the last quarter second";
  const footLine = el("div", "sound__foot-line");
  const keepWrap = el("div", "sound__row-end");
  keepWrap.append(el("span", "sound__label", "Keep:"), review.btn);
  reviewPill = review.btn;
  footLine.append(meter, keepWrap);
  footer.append(footLine, reviewActions);
  panel.append(eqView, adaptView, footer);
  setTab(tab);
}

function partRow(label: string, status: HTMLElement, control: HTMLElement): HTMLDivElement {
  const r = el("div", "sound__part");
  const text = el("div", "sound__part-text");
  text.append(el("span", "sound__label", label), status);
  r.append(text, control);
  return r;
}

function setTab(next: "eq" | "adapt"): void {
  tab = next;
  eqView.hidden = next !== "eq";
  adaptView.hidden = next !== "adapt";
  tabEq.setAttribute("aria-selected", String(next === "eq"));
  tabAdapt.setAttribute("aria-selected", String(next === "adapt"));
  if (parts && !parts.panel.hidden) {
    renderAll();
    if (!reduced()) enterRows(visibleRows(next === "eq" ? eqView : adaptView));
  }
}

function visibleRows(view: HTMLElement): HTMLElement[] {
  return Array.from(view.children).filter((c) => !(c as HTMLElement).hidden) as HTMLElement[];
}

/** Reset: every band to 0 dB (Flat). Saved presets and Custom stay as they were, so Undo is one
 *  pick. For 8 s the Reset button itself says Undo (same place, same size). */
let undoReset: (() => void) | null = null;
let undoTimer = 0;
function resetToFlat(): void {
  const prev = setting("soundEqPreset");
  if (prev === "flat") return;
  selected = -1;
  sound.selectPreset("flat");
  diag.log("sound:reset", { from: prev.startsWith("u:") ? "saved" : prev });
  undoReset = () => {
    endUndo();
    sound.selectPreset(prev);
    diag.log("sound:resetUndone", {});
  };
  resetBtn.textContent = "Undo";
  resetBtn.title = "Brings back the curve from before Reset";
  resetBtn.disabled = false;
  undoTimer = window.setTimeout(() => {
    endUndo();
    renderAll();
  }, 8000);
}
function endUndo(): void {
  window.clearTimeout(undoTimer);
  undoReset = null;
  resetBtn.textContent = "Reset";
  resetBtn.title = "Puts every band back to 0 dB (the Flat preset). Undo is offered for a moment";
}

function foldButton(label: string, title: string, body: () => HTMLElement): HTMLButtonElement {
  const b = el("button", "sound__fold-btn", label);
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-expanded", "false");
  b.addEventListener("click", () => {
    const target = body();
    const open = target.hidden;
    target.hidden = !open;
    b.setAttribute("aria-expanded", String(open));
    if (open) {
      renderStatus();
      enterRows(Array.from(target.children));
    }
  });
  return b;
}

/** Show or hide a part; one that appears slides in like a new row. */
function showPart(e: HTMLElement, on: boolean): void {
  if (e.hidden === !on) return;
  e.hidden = !on;
  if (on && parts && !parts.panel.hidden && !reduced()) enterRows([e]);
}

// ── Editing ─────────────────────────────────────────────────────────────────────────

function cloneBands(): Band[] {
  return bands().map((b) => ({ ...b }));
}

function editBand(fn: (b: Band) => void): void {
  if (selected < 0) return;
  const next = cloneBands();
  if (!next[selected]) return;
  fn(next[selected]);
  sound.commitBands(next);
}

function removeBand(i: number): void {
  if (i < 0) return;
  const next = cloneBands();
  next.splice(i, 1);
  selected = Math.min(i, next.length - 1);
  sound.commitBands(next);
}

function setMode(mode: "parametric" | "graphic"): void {
  selected = -1;
  setSetting("soundEqMode", mode);
}

function wireGraph(): void {
  // Click on empty curve: add a peak there.
  graph.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || setting("soundEqMode") === "graphic" || (e.target as HTMLElement).closest(".sound__handle")) return;
    const r = graph.getBoundingClientRect();
    const list = cloneBands();
    if (list.length >= MAX_BANDS) {
      note(`${MAX_BANDS} bands is the most. Remove one first.`);
      return;
    }
    const f = fOf((e.clientX - r.left) / r.width);
    const g = Math.round(dbOf((e.clientY - r.top) / r.height) * 2) / 2;
    list.push({ on: true, type: "peak", freq: Math.round(f), gain: g, q: 1 });
    list.sort((a, b) => a.freq - b.freq);
    selected = list.findIndex((b) => b.freq === Math.round(f) && b.gain === g);
    commitFromScreen(list);
    diag.log("sound:bandAdd", { n: list.length });
  });
}

function handleFor(i: number, b: Band): HTMLButtonElement {
  const h = el("button", "sound__handle", String(i + 1));
  h.type = "button";
  h.dataset.index = String(i);
  h.title = "Drag to move this band. Wheel: wider or narrower. Double-click: back to 0 dB. Delete: remove";
  h.setAttribute("aria-label", `Band ${i + 1}: ${TYPES.find((t) => t.type === b.type)?.label}, ${hz(b.freq)}`);
  h.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    selected = i;
    dragging = true;
    live = cloneBands();
    h.setPointerCapture(e.pointerId);
    h.toggleAttribute("data-dragging", true);
    renderBandRow();
    renderHandles();
  });
  h.addEventListener("pointermove", (e) => {
    if (!dragging || !live || selected !== i) return;
    const r = graph.getBoundingClientRect();
    const band = live[i];
    band.freq = Math.round(fOf((e.clientX - r.left) / r.width));
    if (hasGain(band.type)) band.gain = Math.round(dbOf((e.clientY - r.top) / r.height) * 10) / 10;
    sound.previewBands(live);
    renderCurve();
    renderHandles();
    renderBandRow();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    h.toggleAttribute("data-dragging", false);
    const done = live;
    live = null;
    if (done) sound.commitBands(done);
  };
  h.addEventListener("pointerup", end);
  h.addEventListener("pointercancel", end);
  h.addEventListener("wheel", (e) => {
    e.preventDefault();
    selected = i;
    editBand((band) => (band.q = Math.max(0.1, Math.min(10, Math.round(band.q * (e.deltaY < 0 ? 1.12 : 1 / 1.12) * 100) / 100))));
  }, { passive: false });
  h.addEventListener("dblclick", () => {
    selected = i;
    editBand((band) => hasGain(band.type) && (band.gain = 0));
  });
  h.addEventListener("keydown", (e) => {
    selected = i;
    const semitone = Math.pow(2, 1 / 12);
    if (e.key === "ArrowLeft") editBand((band) => (band.freq = Math.max(F_LO, Math.round(band.freq / semitone))));
    else if (e.key === "ArrowRight") editBand((band) => (band.freq = Math.min(F_HI, Math.round(band.freq * semitone))));
    else if (e.key === "ArrowUp") editBand((band) => hasGain(band.type) && (band.gain = Math.min(DB_RANGE, band.gain + 0.5)));
    else if (e.key === "ArrowDown") editBand((band) => hasGain(band.type) && (band.gain = Math.max(-DB_RANGE, band.gain - 0.5)));
    else if (e.key === "PageUp") editBand((band) => (band.q = Math.min(10, band.q * 1.12)));
    else if (e.key === "PageDown") editBand((band) => (band.q = Math.max(0.1, band.q / 1.12)));
    else if (e.key === "Delete" || e.key === "Backspace") removeBand(i);
    else return;
    e.preventDefault();
  });
  return h;
}

/** An edit made on screen. While the equalizer is off the screen shows Flat, so the edit is a new
 *  Custom curve (never an edit of the hidden preset), and it turns the equalizer on. */
function commitFromScreen(next: Band[]): void {
  if (!setting("soundEq")) {
    setSetting("soundEqCustom", { name: "Custom", bands: next, design: "matched" });
    sound.selectPreset("custom");
    setSetting("soundEq", true);
    return;
  }
  sound.commitBands(next);
}

/** The ten slider gains for the current curve: the bands themselves, or a fit of any other curve. */
let fitCache: { key: string; bands: Band[] } | null = null;
function graphicBands(): Band[] {
  const list = bands();
  if (isGraphic(list)) return list;
  const p = sound.activePreset();
  const key = JSON.stringify([list, p.design]);
  if (fitCache?.key !== key) fitCache = { key, bands: fitGraphic(list, p.design, sound.sampleRateNow()) };
  return fitCache.bands;
}

function buildFaders(): void {
  faderHandles = GRAPHIC_FREQS.map((f, i) => {
    const fader = el("div", "sound__fader");
    fader.setAttribute("role", "slider");
    fader.tabIndex = 0;
    fader.setAttribute("aria-label", `${hz(f)} fader`);
    fader.setAttribute("aria-valuemin", "-12");
    fader.setAttribute("aria-valuemax", "12");
    fader.title = `${hz(f)}: drag up for more, down for less`;
    fader.style.setProperty("--x", String(xOf(f)));
    fader.append(el("span", "sound__fader-track"), el("span", "sound__fader-knob"));
    const toGain = (frac: number) => Math.round((frac * 2 - 1) * DB_RANGE * 2) / 2;
    const slider = makeSlider(fader, {
      axis: "y",
      onDrag: (frac) => {
        dragging = true;
        live ??= graphicBands().map((b) => ({ ...b }));
        live[i].gain = toGain(frac);
        sound.previewBands(live);
        renderCurve();
        fader.setAttribute("aria-valuenow", String(toGain(frac)));
      },
      onCommit: (frac) => {
        dragging = false;
        const done = live ?? graphicBands().map((b) => ({ ...b }));
        live = null;
        done[i].gain = toGain(frac);
        commitFromScreen(done);
      },
    });
    fader.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowUp" ? 0.5 : e.key === "ArrowDown" ? -0.5 : 0;
      if (!step) return;
      e.preventDefault();
      const next = graphicBands().map((b) => ({ ...b }));
      next[i].gain = Math.max(-DB_RANGE, Math.min(DB_RANGE, next[i].gain + step));
      commitFromScreen(next);
    });
    faders.append(fader);
    return { el: fader, slider };
  });
}

// ── Preset actions ──────────────────────────────────────────────────────────────────

let noteTimer = 0;
function note(text: string, action?: { label: string; run: () => void }): void {
  window.clearTimeout(noteTimer);
  eqNote.replaceChildren(el("span", "", text));
  if (action) {
    const b = el("button", "sound__chip", action.label);
    b.type = "button";
    b.title = "Brings back what was there before";
    b.addEventListener("click", () => {
      action.run();
      showPart(eqNote, false);
    });
    eqNote.append(b);
    noteTimer = window.setTimeout(() => showPart(eqNote, false), 8000);
  }
  showPart(eqNote, !!text);
}

function askName(mode: "save" | "rename"): void {
  nameMode = mode;
  nameInput.value = mode === "rename" ? sound.activePreset().name : "";
  showPart(nameRow, true);
  nameInput.focus();
}

function commitName(): void {
  const name = nameInput.value.trim();
  if (!name) return;
  const id = setting("soundEqPreset");
  if (nameMode === "rename" && id.startsWith("u:")) {
    setSetting("soundEqUser", { ...setting("soundEqUser"), [id]: { ...sound.activePreset(), name } });
  } else {
    addUserPreset({ ...sound.activePreset(), name, bands: cloneBands() });
  }
  showPart(nameRow, false);
}

function addUserPreset(p: EqPreset): void {
  const id = `u:${Date.now().toString(36)}`;
  setSetting("soundEqUser", { ...setting("soundEqUser"), [id]: p });
  selected = -1;
  sound.selectPreset(id);
  diag.log("sound:presetSaved", { bands: p.bands.length, design: p.design });
}

function deletePreset(): void {
  const id = setting("soundEqPreset");
  if (!id.startsWith("u:")) return;
  if (!deleteArmed) {
    deleteArmed = true;
    deleteBtn.textContent = "Delete?";
    window.setTimeout(() => {
      deleteArmed = false;
      deleteBtn.textContent = "Delete";
    }, 3000);
    return;
  }
  deleteArmed = false;
  deleteBtn.textContent = "Delete";
  const user = { ...setting("soundEqUser") };
  const name = user[id]?.name ?? "";
  delete user[id];
  sound.selectPreset("flat");
  setSetting("soundEqUser", user);
  note(`Deleted ${name}.`);
}

function importText(text: string, name: string): void {
  const { preset, notes } = parseApo(text, name);
  if (!preset) {
    note(`Nothing imported: ${notes.join(", ")}.`);
    return;
  }
  addUserPreset(preset);
  if (setting("soundEqMode") === "graphic") setSetting("soundEqMode", "parametric");
  note(`Imported ${preset.bands.length} band${preset.bands.length === 1 ? "" : "s"}${notes.length ? ` (${notes.join(", ")})` : ""}.`);
}

function importFile(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,.cfg,text/plain";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((t) => importText(t, file.name.replace(/\.[^.]+$/, "").slice(0, 40)));
  });
  input.click();
}

async function pasteText(): Promise<void> {
  try {
    importText(await navigator.clipboard.readText(), "Pasted");
  } catch {
    note("The clipboard could not be read.");
  }
}

async function copyText(): Promise<void> {
  const p = sound.activePreset();
  try {
    await navigator.clipboard.writeText(toApo(p, currentPreampDb()));
    note("Copied as Equalizer APO text.");
  } catch {
    note("The clipboard could not be written.");
  }
}

function currentPreampDb(): number {
  if (!setting("soundEq")) return 0;
  return sound.preampFor(bands());
}

// ── Rendering ───────────────────────────────────────────────────────────────────────

function renderAll(): void {
  renderIcon();
  if (!parts || parts.panel.hidden) return;
  syncs.forEach((s) => s());
  const graphic = setting("soundEqMode") === "graphic";
  const on = setting("soundEq");
  eqPill.textContent = on ? "On" : "Off";
  eqPill.setAttribute("aria-pressed", String(on));
  graph.toggleAttribute("data-off", !on);
  graph.dataset.mode = graphic ? "graphic" : "parametric";
  handles.hidden = graphic;
  faders.hidden = !graphic;
  modePill.textContent = graphic ? "Sliders" : "Dots";
  presetName.textContent = shownName();
  const user = setting("soundEqPreset").startsWith("u:");
  if (undoReset && setting("soundEqPreset") !== "flat") endUndo(); // another pick ends the offer
  resetBtn.disabled = !undoReset && (!setting("soundEq") || setting("soundEqPreset") === "flat");
  renameBtn.disabled = !user;
  deleteBtn.disabled = !user;
  adaptivePill.textContent = setting("soundAdaptive") ? "On" : "Off";
  adaptivePill.setAttribute("aria-pressed", String(setting("soundAdaptive")));
  parts.panel.toggleAttribute("data-adaptive-off", !setting("soundAdaptive"));
  // Always shown (no jump in the rows below); live only for Set by hand.
  const manual = setting("soundEqPreamp") === "manual";
  preampRow.toggleAttribute("data-inactive", !manual);
  preampRow.querySelectorAll("button").forEach((b) => (b.disabled = !manual));
  preampValue.textContent = db(setting("soundEqPreampDb"));
  if (selected >= bands().length) selected = -1;
  renderCurve();
  renderHandles();
  renderFaders();
  renderBandRow();
  renderStatus();
}

// The meter holds the worst of each half second, so the numbers read instead of flickering.
let meterHold = { limiterDb: 0, peakDb: -Infinity, since: 0 };
function renderMeter(): void {
  const st = sound.busStatus();
  const routed = sound.routedElements() > 0 && sound.contextState() === "running";
  const show = routed && !!st && (setting("soundEq") || setting("soundAdaptive"));
  meter.hidden = !show;
  if (!show || !st) return;
  meterHold.limiterDb = Math.min(meterHold.limiterDb, st.limiterDb);
  meterHold.peakDb = Math.max(meterHold.peakDb, st.outPeakDb);
  const now = performance.now();
  if (now - meterHold.since < 500 && meter.textContent) return;
  const cut = meterHold.limiterDb < -0.05 ? `Limiter ${db(meterHold.limiterDb)}` : "Limiter idle";
  meter.textContent = `${cut} · peak ${meterHold.peakDb > -100 ? `${meterHold.peakDb.toFixed(1)} dBFS` : "silent"}`;
  meterHold = { limiterDb: 0, peakDb: -Infinity, since: now };
}

function renderIcon(): void {
  if (!parts) return;
  const on = setting("soundEq") || setting("soundAdaptive");
  parts.btn.innerHTML = icon(sound.activePreset().bands, setting("soundEq"));
  parts.btn.toggleAttribute("data-armed", on);
  const what: string[] = [];
  if (setting("soundEq")) what.push(`${sound.activePreset().name} EQ`);
  if (setting("soundAdaptive")) {
    if (setting("soundLoudness")) what.push("Match loudness");
    if (setting("soundLowVol") !== "off") what.push("Fuller at low volume");
    if (sound.crossfeedState().on) what.push("Crossfeed");
  }
  parts.btn.title = what.length ? `Sound: ${what.join(" · ")}` : "Sound: the equalizer and adaptive sound. Everything is off";
}

function renderCurve(): void {
  const fs = sound.sampleRateNow();
  const p = sound.activePreset();
  const chain = bands().flatMap((b) => bandBiquads(b, fs, p.design));
  let d = "";
  CURVE_FREQS.forEach((f, i) => {
    const x = xOf(f) * PLOT_W;
    const y = yOf(chain.length ? chainDb(chain, f, fs) : 0) * PLOT_H;
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  curvePath.setAttribute("d", d);
  fillPath.setAttribute("d", `${d}L${PLOT_W} ${PLOT_H / 2}L0 ${PLOT_H / 2}Z`);
  renderShape();
}

function renderHandles(): void {
  if (setting("soundEqMode") === "graphic") return;
  const list = bands();
  // Rebuilt only when the count changes, so a dot keeps keyboard focus through its own edits.
  if (handles.children.length !== list.length) handles.replaceChildren(...list.map((b, i) => handleFor(i, b)));
  list.forEach((b, i) => {
    const h = handles.children[i] as HTMLElement | undefined;
    if (!h) return;
    h.style.setProperty("--x", String(xOf(b.freq)));
    h.style.setProperty("--y", String(yOf(hasGain(b.type) ? b.gain : 0)));
    h.toggleAttribute("data-selected", i === selected);
    h.toggleAttribute("data-band-off", !b.on);
    h.setAttribute("aria-label", `Band ${i + 1}: ${TYPES.find((t) => t.type === b.type)?.label}, ${hz(b.freq)}${hasGain(b.type) ? `, ${db(b.gain)}` : ""}`);
  });
}

function renderFaders(): void {
  const list = graphicBands();
  faderHandles.forEach(({ el: f, slider }, i) => {
    const gain = list[i].gain;
    slider.setValue((gain + DB_RANGE) / (2 * DB_RANGE));
    f.setAttribute("aria-valuenow", String(gain));
    f.title = `${hz(GRAPHIC_FREQS[i])}: ${db(gain)}. Drag up for more, down for less`;
  });
}

function renderBandRow(): void {
  const list = bands();
  const b = list[selected];
  const show = setting("soundEqMode") === "parametric" && !!b;
  showPart(bandRow, show);
  if (!b) return;
  bandType.textContent = TYPES.find((t) => t.type === b.type)?.label ?? "Peak";
  bandReadout.textContent = `${hz(b.freq)}${hasGain(b.type) ? ` · ${db(b.gain)}` : ""} · Q ${b.q.toFixed(2)}`;
  bandOn.textContent = b.on ? "On" : "Off";
  bandOn.setAttribute("aria-pressed", String(b.on));
}

/** The preamp line of "How the equalizer decides", with this moment's numbers. */
function preampWhy(peak: number): string {
  const boost = Math.max(0, peak);
  const room = sound.headroomDb();
  const roomText = sound.getOutput().kind === "airplay"
    ? "The speaker holds the volume, so the song arrives at full scale"
    : `The volume leaves ${db(room)} of room before full scale`;
  switch (setting("soundEqPreamp")) {
    case "limiter":
      return `Preamp: limiter only. The song is never lowered; the curve's boost of ${db(boost)} plays as drawn, and the limiter holds any peak over −1 dBFS. ${roomText}. On a loud song at full volume the limiter may dip the level on bass hits.`;
    case "needed":
      return `Preamp: when needed. ${roomText}; the curve's boost is ${db(boost)}, so the song is lowered by ${db(Math.max(0, boost - room))}. The limiter holds anything left over −1 dBFS.`;
    case "always":
      return `Preamp: always. The song is lowered by the curve's boost, ${db(boost)}, whatever the volume. Nothing clips, but a boost makes the rest of the song quieter.`;
    case "manual":
      return `Preamp: set by hand to ${db(setting("soundEqPreampDb"))}. The limiter holds anything over −1 dBFS.`;
  }
}

function renderStatus(): void {
  if (!parts || parts.panel.hidden) return;
  const out = sound.getOutput();
  const p = sound.activePreset();
  const on = setting("soundEq");
  const fs = sound.sampleRateNow();
  const peak = sound.curvePeakDb(bands(), p.design, fs);

  // EQ
  eqStatus.textContent = on
    ? `${out.name} · ${p.name} · preamp ${db(currentPreampDb())}`
    : `Off. ${out.name} would play ${p.name}.`;
  const outKind = out.kind === "unknown" ? "its type is not known yet (output detection is the next build step)" : `Windows reports ${out.kind}`;
  eqWhy.replaceChildren(
    el("p", "", `Output: ${out.name}; ${outKind}.`),
    el("p", "", setting("soundEqPerOutput")
      ? "Per output is on: a preset you pick is remembered for the output that is playing, and a change of output brings its preset back."
      : "Per output is off: one preset plays on every output."),
    el("p", "", preampWhy(peak)),
    el("p", "", p.design === "rbj"
      ? "This preset was imported: it uses the filters its author designed for (RBJ), so it sounds as measured."
      : "Bands made here use matched filters: the shape you draw holds up to 20 kHz."),
  );
  const map = setting("soundEqOutputs");
  outputsList.replaceChildren(
    ...Object.entries(map).map(([k, id]) => {
      const r = el("div", "sound__output");
      const label = k === out.key ? `${out.name} (playing)` : k === "default" ? "This PC" : k;
      r.append(el("span", "sound__label", label), el("span", "sound__readout", sound.presetFor(id).name));
      const forget = el("button", "sound__icon-btn", "×");
      forget.type = "button";
      forget.title = "Forgets the preset for this output";
      forget.setAttribute("aria-label", "Forget");
      forget.addEventListener("click", () => {
        const next = { ...setting("soundEqOutputs") };
        delete next[k];
        setSetting("soundEqOutputs", next);
      });
      r.append(forget);
      return r;
    }),
  );

  // Adaptive
  const adaptive = setting("soundAdaptive");
  const offLine = "Adaptive sound is off.";
  loudStatus.textContent = !adaptive ? offLine : !setting("soundLoudness") ? "Off." : "Not built yet: measuring comes in a later build step.";
  const lowMode = setting("soundLowVol");
  const duck = getDuck();
  const app = duck > 0 ? getVolume() / duck : getVolume();
  const win = sound.getWindowsMaster();
  const both = setting("soundLowVolKey") === "both";
  const drop = sound.volumeDropDb();
  const shelves = lowVolumeShelves(drop, lowMode === "full" ? 1 : lowMode === "gentle" ? 0.5 : 0);
  const levelText = both ? `App ${pct(app)} × Windows ${win.known ? pct(win.value) : "not read yet"}` : `App ${pct(app)}`;
  lowStatus.textContent = !adaptive
    ? offLine
    : lowMode === "off"
      ? "Off."
      : `${levelText} = ${db(-drop)} → ${db(shelves.low)} bass, ${db(shelves.high)} treble.`;
  const xf = sound.crossfeedState();
  xfStatus.textContent = !adaptive ? offLine : `${xf.why}${xf.on ? " → on." : setting("soundCrossfeed") === "off" ? "" : " → off."}`;
  const unmeasured = setting("soundLoudUnmeasured") === "median" ? "get the library's median gain" : "play unchanged";
  adaptWhy.replaceChildren(
    el("p", "", `Match loudness measures each song while it plays and counts it once 80 % is heard without a skip. Every song is set to ${setting("soundLoudTarget")} LUFS.${setting("soundLoudAlbum") ? " An album played in order keeps one gain." : ""} Songs not measured yet ${unmeasured}.`),
    el("p", "", `Fuller at low volume follows ${both ? "the app slider × the Windows volume" : "the app slider"}. At full volume it adds nothing; the quieter it gets, the more bass at 100 Hz and a little treble at 10 kHz, from the ISO 226 equal-loudness curves.`),
    el("p", "", "Headphone crossfeed, on Auto, turns on when Windows reports headphones or a headset, and off for speakers."),
  );

  // Review
  const first = setting("soundFirstOn");
  const due = sound.reviewDue();
  const reviewed = setting("soundReviewed");
  const isDue = !!due && !reviewed && Date.now() >= due;
  reviewStatus.textContent = !first
    ? "Asks whether to keep the effects this long after you first turn one on"
    : reviewed
      ? "You chose to keep the effects"
      : due
        ? isDue ? "Time to decide whether to keep the effects" : `Asks whether to keep the effects on ${day(due)}`
        : "Never asks whether to keep the effects";
  reviewPill.title = `${reviewStatus.textContent}. Click for the next choice`;
  showPart(reviewActions, isDue);

  // Meter
  renderMeter();
}

// ── The song's shape (SOUND.md §2.5): read before any effect, averaged over the song ─────

let shapeTimer = 0;
let shapeTap: AnalyserNode | null = null;
let shapeBins: Float32Array | null = null;
const shapeAcc = new Float64Array(SHAPE_FREQS.length);
let shapeFrames = 0;

function resetShape(): void {
  shapeAcc.fill(0);
  shapeFrames = 0;
  if (parts && !parts.panel.hidden) renderShape();
}

async function startShape(): Promise<void> {
  stopShape();
  shapeTap = await sound.setInspecting(true);
  if (!shapeTap || !parts || parts.panel.hidden) return;
  shapeBins = new Float32Array(shapeTap.frequencyBinCount);
  shapeTimer = window.setInterval(sampleShape, 100);
  renderStatus();
}

function stopShape(): void {
  window.clearInterval(shapeTimer);
  shapeTimer = 0;
  shapeTap = null;
  if (listening) {
    listening = null;
    sound.setSolo(null);
  }
  void sound.setInspecting(false);
}

/** One 100 ms look: each band's mean power, added to the song's running sum (silence skipped). */
function sampleShape(): void {
  if (!shapeTap || !shapeBins) return;
  shapeTap.getFloatFrequencyData(shapeBins);
  const binHz = sound.sampleRateNow() / shapeTap.fftSize;
  const powers = new Float64Array(SHAPE_FREQS.length);
  let total = 0;
  const edge = Math.pow(F_HI / F_LO, 1 / (2 * (SHAPE_FREQS.length - 1)));
  SHAPE_FREQS.forEach((f, k) => {
    const lo = Math.max(1, Math.floor(f / edge / binHz));
    const hi = Math.min(shapeBins!.length - 1, Math.max(lo, Math.ceil((f * edge) / binHz)));
    let sum = 0;
    for (let b = lo; b <= hi; b++) sum += Math.pow(10, shapeBins![b] / 10);
    powers[k] = sum / (hi - lo + 1);
    total += powers[k];
  });
  if (total < 1e-12) return; // paused or silent: not part of the song's shape
  powers.forEach((v, k) => (shapeAcc[k] += v));
  shapeFrames++;
  renderShape();
  if (shapeFrames === SHAPE_MIN_FRAMES || shapeFrames % 20 === 0) renderReading();
}

/** The song's level per band in dB, against the 4.5 dB/octave slope; null until there is sound. */
function shapeDb(): number[] | null {
  if (!shapeFrames) return null;
  return SHAPE_FREQS.map((f, k) => 10 * Math.log10(Math.max(shapeAcc[k] / shapeFrames, 1e-20)) + SHAPE_SLOPE_DB_PER_OCT * Math.log2(f / 1000));
}

/** What the effects add at `f`, in dB: the EQ curve and Fuller at low volume's shelves. */
function effectDbAt(freqs: number[]): number[] {
  const fs = sound.sampleRateNow();
  const p = sound.activePreset();
  const chain = setting("soundEq") ? bands().flatMap((b) => bandBiquads(b, fs, p.design)) : [];
  const mode = setting("soundLowVol");
  if (setting("soundAdaptive") && mode !== "off") {
    const sh = lowVolumeShelves(sound.volumeDropDb(), mode === "full" ? 1 : 0.5);
    chain.push(rbj("lowshelf", 100, sh.low, 0.707, fs), rbj("highshelf", 10000, sh.high, 0.707, fs));
  }
  return freqs.map((f) => (chain.length ? chainDb(chain, f, fs) : 0));
}

function renderShape(): void {
  const shape = shapeDb();
  if (!shape) {
    songPath.setAttribute("d", "");
    heardPath.setAttribute("d", "");
    return;
  }
  const top = Math.max(...shape) + 3;
  const yAt = (v: number) => Math.max(0, Math.min(PLOT_H, ((top - v) / SHAPE_RANGE_DB) * PLOT_H));
  let area = `M0 ${PLOT_H}`;
  let line = "";
  const add = effectDbAt(SHAPE_FREQS);
  const differs = add.some((v) => Math.abs(v) > 0.1);
  SHAPE_FREQS.forEach((f, k) => {
    const x = (xOf(f) * PLOT_W).toFixed(1);
    area += `L${x} ${yAt(shape[k]).toFixed(1)}`;
    line += `${k ? "L" : "M"}${x} ${yAt(shape[k] + add[k]).toFixed(1)}`;
  });
  songPath.setAttribute("d", `${area}L${PLOT_W} ${PLOT_H}Z`);
  heardPath.setAttribute("d", differs ? line : "");
}

/** Each zone against the song's own average, in dB (the reading's numbers). */
function zoneBalance(): { id: string; label: string; words: string; db: number }[] | null {
  const shape = shapeDb();
  if (!shape || shapeFrames < SHAPE_MIN_FRAMES) return null;
  const means = ZONES.map((z) => {
    const ks = SHAPE_FREQS.map((f, k) => (f >= z.lo && f < z.hi ? k : -1)).filter((k) => k >= 0);
    return ks.reduce((sum, k) => sum + shape[k], 0) / ks.length;
  });
  const avg = means.reduce((a, b) => a + b, 0) / means.length;
  return ZONES.map((z, i) => ({ id: z.id, label: z.label, words: z.words, db: means[i] - avg }));
}

/** The one-line reading: which zones stand out, in plain words. */
function readingText(): string {
  const zb = zoneBalance();
  if (!zb) return sound.routedElements() ? "Listening. The song's shape fills in as it plays." : "Play a song to see its shape.";
  const heavy = [...zb].sort((a, b) => b.db - a.db)[0];
  const soft = [...zb].sort((a, b) => a.db - b.db)[0];
  const parts: string[] = [];
  if (heavy.db >= 3) parts.push(`heavy in ${heavy.words}`);
  if (soft.db <= -3) parts.push(`soft in ${soft.words}`);
  return parts.length ? `This song is ${parts.join(" and ")}.` : "This song is evenly balanced.";
}

function renderReading(): void {
  const text = readingText();
  infoBtn.title = `${text} Click for the numbers`;
  if (infoBody.hidden) return;
  const zb = zoneBalance();
  const rows = el("div", "sound__balance");
  (zb ?? []).forEach((z) => {
    const r = el("div", "sound__balance-row");
    const bar = el("span", "sound__balance-bar");
    const v = Math.max(-1, Math.min(1, z.db / 9)); // ±9 dB fills half the bar
    bar.style.setProperty("--bar-left", `${50 + Math.min(0, v) * 50}%`);
    bar.style.setProperty("--bar-width", `${Math.abs(v) * 50}%`);
    r.append(el("span", "sound__label", z.label), bar, el("span", "sound__readout", db(z.db)));
    rows.append(r);
  });
  infoBody.replaceChildren(
    el("p", "sound__reading", text),
    ...(zb ? [rows] : []),
    el(
      "p",
      "sound__why",
      `Measured from this song before any effect, over ${Math.round(shapeFrames / 10)} s of sound since the panel opened. Each zone is compared with the song's own average, after a ${SHAPE_SLOPE_DB_PER_OCT} dB per octave slope that most mixes follow, so a balanced song reads near 0 dB everywhere. A zone 3 dB or more above or below stands out.`,
    ),
  );
}
