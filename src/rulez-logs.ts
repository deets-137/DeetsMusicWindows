// Rulez's Logs view (docs/features/RULEZ.md §3, the L route): what the rules did, in words.
// Four parts: What ran (the rule lines from the diag ring, newest first; Raw shows them as
// logged), Last ran (each rule's last fire, route 1: his call puts it here only), Holding now
// (what each While rule lays, and where your change holds), and Facts now (every fact the
// engine reads, with its value). It reads; it changes nothing.

import { events, type DiagEvent } from "./diag";
import { ruleStats, type Snap } from "./rules";
import type { Rule } from "./rules-eval";
import { FACTS, actionText, eventLabel, leafText, valueText, type Lists } from "./rulez-words";
import { RECIPES } from "./rules-recipes";
import { esc } from "./dom";

/** The diag tags the rules engine and its actions write. */
const RULE_TAG = /^(rule|rule:(snap|hold|hand|resume|trip|skip|recipe|volume)|grow:rule|grow:kept|sleep:daily|sound:ruleTone|sound:balance(On|Off)|player:resumeStation)$/;
export const isRuleLine = (e: DiagEvent): boolean => RULE_TAG.test(e.tag);

const MAX_LINES = 80;

/** A diag line's time as a clock time (the ring counts ms since the page loaded). */
function clockOf(t: number): string {
  const at = new Date(Date.now() - (performance.now() - t));
  return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

const TARGETS: Record<string, string> = {
  "key:theme": "the theme", "key:skin": "the skin", "key:soundEqPreset": "the EQ preset", "key:cardGrowOutside": "Collapse on outside click",
  "key:shareActivityApp": "sharing in the app", "key:shareActivityDiscord": "sharing on Discord", "key:discordRoomInvite": "room invites on Discord",
  "prop:window.onTop": "Keep on top", "prop:volume": "the volume", "prop:tone.bass": "the bass", "prop:tone.mids": "the mids",
  "prop:tone.treble": "the treble", "prop:tone.preamp": "the preamp",
  "key:backgroundMotion": "Animate backgrounds", "key:appearanceMotion": "Animate look changes", "key:cardSwapMotion": "Animate card swaps",
  "key:fancyScrubber": "Fancy scrubber", "key:glassFancy": "Fancy Glass", "key:friendsListenAlong": "Let friends listen along",
  "key:friendsRoomInvite": "Put my room code on my box", "key:toasts": "Show notices",
  "key:webPlayNew": "Play a web from the song playing", "key:webPlayMode": "how a web from the song playing plays",
  "key:webSkipSeed": "Skip the song you just heard", "key:webSkipSeedAt": "the skip point of the song you just heard",
};
const targetWords = (t: unknown) => TARGETS[String(t)] ?? String(t);

const REASONS: Record<string, string> = {
  "no rule": "no rule matched",
  held: "held back while the rules were being checked",
  chain: "a chain of rules stopped here (8 in a row)",
  hand: "your change holds",
  ended: "its condition ended",
};

/** A value a While rule lays, as words ("Moonlight", "40%", "−3 dB", "On"). */
function valueWords(target: string, v: unknown, L: Lists): string {
  const pick = (list: { value: unknown; label: string }[]) => list.find((c) => c.value === v)?.label ?? String(v);
  if (target === "key:theme") return pick(L.themes);
  if (target === "key:skin") return pick(L.skins);
  if (target === "key:soundEqPreset") return pick(L.presets);
  if (target === "prop:volume") return `${v}%`;
  if (target.startsWith("prop:tone.")) return `${Number(v) > 0 ? "+" : ""}${v} dB`;
  if (typeof v === "boolean") return v ? "On" : "Off";
  return String(v);
}

/** One diag line as a sentence. */
export function lineWords(e: DiagEvent, name: (id: string) => string, L: Lists): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const who = d.id ? name(String(d.id)) : "";
  const ev = d.event ? eventLabel(d.event as never) : "";
  switch (e.tag) {
    case "rule": {
      if (d.target !== undefined)
        return d.applied ? `${who} now sets ${targetWords(d.target)}.` : `${who} let go of ${targetWords(d.target)}: ${REASONS[String(d.reason)] ?? d.reason}.`;
      if (d.applied) {
        const act = actionText({ [String(d.do)]: d.arg } as never, L);
        const inCard = d.card && d.card !== "*" ? ` in ${d.card}` : "";
        const step = d.depth ? ` Another rule set it off (step ${d.depth}).` : "";
        return `${who} ran on "${ev}"${inCard}: ${act}.${step}`;
      }
      const why = String(d.reason ?? "");
      const lost = why.startsWith("lost to ") ? `lost to ${name(why.slice(8))}` : REASONS[why] ?? why;
      return `${ev || "An event"}: ${who ? `${who} did not run, ` : ""}${lost}.`;
    }
    case "rule:hold": return `${who} stands aside no more for ${targetWords(d.target)}.`;
    case "rule:hand": return `You changed ${targetWords(d.target)} while ${who} set it.`;
    case "rule:resume": return `${who} acts again (Resume).`;
    case "rule:trip": return `${who} ran 5 times in 10 s and is off until DeetsMusic starts again.`;
    case "rule:skip": return `${who} cannot run: ${d.why}.`;
    case "rule:recipe": return `The recipe ${RECIPES.find((x) => x.id === d.id)?.name ?? d.id} is ${d.on ? "on" : "off"}.`;
    case "rule:volume": return d.laid !== undefined ? `A rule set the volume to ${d.laid}%.` : `The volume went back to ${d.back ?? "yours"}%.`;
    case "grow:rule": return d.applied ? `A rule grew ${d.card} (${d.dir}).` : `A rule did not grow ${d.card}: ${d.reason}.`;
    case "grow:kept": return `A rule kept the grown card open (${d.on === "back" ? "on Back" : `you pressed ${d.pressed || "outside"}`}).`;
    case "sleep:daily": return `Sleep every day: ${JSON.stringify(d)}.`;
    case "sound:ruleTone": return `A rule set the ${d.part} to ${d.db} dB.`;
    case "sound:balanceOn": return "A rule reads the song's balance: the balance watch runs.";
    case "sound:balanceOff": return "No rule reads the song's balance: the balance watch stopped.";
    case "player:resumeStation": return d.kept ? "A rule kept the station from coming back." : "The station came back.";
  }
  return `${e.tag} ${JSON.stringify(d)}`;
}

const VERDICT: Record<string, string> = {
  ran: "ran", lost: "lost to a rule above", no: "did not run: a condition is not true", refused: "was held back",
  holds: "now holds", ended: "let go: its condition ended", hand: "stands aside: your change holds",
};

/** The facts of a moment as rows (the words the If menus use). */
function factRows(f: Snap["facts"], L: Lists): string {
  return FACTS.filter((w) => f[w.id] !== undefined)
    .map((w) => {
      const v = f[w.id]!;
      const text = Array.isArray(v) ? v.join(", ") : w.kind === "bool" ? (v ? w.yes! : w.no!) : valueText(w, v, L);
      return `<div class="rulez-log__fact"><span>${esc(w.label)}</span><span>${esc(text)}</span></div>`;
    })
    .join("");
}

/** A snapshot line (RULEZ.md §9): a sentence that opens to each rule it checked, each condition
 *  with ✓ / ✗, and every fact at that moment. Native <details>: no script to open it. */
function snapHTML(e: DiagEvent, name: (id: string) => string, L: Lists): string {
  const s = e.data as Snap;
  const first = s.rules[0];
  const what = s.event ? `"${eventLabel(s.event)}"${s.card && s.card !== "*" ? ` in ${s.card}` : ""}` : "a condition changed";
  const more = s.rules.length > 1 ? ` (${s.rules.length - 1} more checked)` : "";
  const chain = s.depth ? ` Another rule set it off (step ${s.depth}).` : "";
  const head = `${name(first.id)} ${VERDICT[first.verdict] ?? first.verdict} on ${what}.${more}${chain}`;
  const rules = s.rules
    .map((r) => {
      const conds = r.conds.length
        ? r.conds.map((c) => `<div class="rulez-log__cond${c.holds ? " is-yes" : ""}">${c.holds ? "✓" : "✗"} ${esc(leafText(c.leaf, L))}</div>`).join("")
        : `<div class="rulez-log__cond is-yes">✓ No condition</div>`;
      return `<div class="rulez-log__rule"><b>${esc(name(r.id))}</b> ${esc(VERDICT[r.verdict] ?? r.verdict)}${r.reason && r.verdict !== "lost" ? ` (${esc(r.reason)})` : ""}${conds}</div>`;
    })
    .join("");
  return `<details class="rulez-log__snap"><summary><span class="rulez-log__time">${clockOf(e.t)}</span><span class="rulez-log__text">${esc(head)}</span></summary>
    <div class="rulez-log__body">${rules}<div class="rulez-log__facts">${factRows(s.facts, L)}</div></div></details>`;
}

/** The Logs view's HTML. `rules` = every rule Rulez knows (yours, the recipes, the built-in). */
export function logsHTML(rules: readonly Rule[], name: (id: string) => string, L: Lists, raw: boolean): string {
  const st = ruleStats();
  // In words, a snapshot says what its `rule` lines say, and more: those lines step aside.
  const covered = (e: DiagEvent) => e.tag === "rule" && !!(e.data as { id?: string } | undefined)?.id;
  const lines = events().filter((e) => isRuleLine(e) && (raw || !covered(e))).slice(-MAX_LINES).reverse();
  const ran = lines.length
    ? lines.map((e) =>
        !raw && e.tag === "rule:snap"
          ? snapHTML(e, name, L)
          : `<div class="rulez-log__line"><span class="rulez-log__time">${clockOf(e.t)}</span><span class="rulez-log__text${raw ? " rulez-log__text--raw" : ""}">${esc(raw ? `${e.tag} ${JSON.stringify(e.data ?? "")}` : lineWords(e, name, L))}</span></div>`,
      ).join("")
    : `<p class="rulez__empty">Nothing yet. A line shows here each time a rule runs, holds or lets go.</p>`;

  const last = rules
    .map((r) => {
      const at = st.lastRun.get(r.id);
      const recent = (st.fires.get(r.id) ?? []).filter((t) => Date.now() - t < 10_000).length;
      const off = st.offForSession.has(r.id) ? " · off until restart" : "";
      const held = r.kind === "state" && [...st.applied.values()].includes(r.id) ? "holding now" : "";
      const when = at ? ago(at) : held || "never";
      return `<div class="rulez-log__line"><span class="rulez-log__time">${esc(when)}</span><span class="rulez-log__text">${esc(name(r.id))}${recent > 1 ? ` · ${recent} times in 10 s` : ""}${off}</span></div>`;
    })
    .join("");

  const holding = [...st.applied].map(([t, id]) => {
    const v = valueWords(t, st.appliedValue.get(t), L);
    return `<div class="rulez-log__line"><span class="rulez-log__time">${esc(targetWords(t))}</span><span class="rulez-log__text">${esc(`${v} — from ${name(id)}`)}</span></div>`;
  });
  for (const [t, id] of st.held) holding.push(`<div class="rulez-log__line"><span class="rulez-log__time">${esc(targetWords(t))}</span><span class="rulez-log__text">${esc(`Your pick holds; ${name(id)} waits`)}</span></div>`);

  const facts = FACTS.filter((f) => st.facts[f.id] !== undefined)
    .map((f) => {
      const v = st.facts[f.id]!;
      const text = Array.isArray(v) ? v.join(", ") : f.kind === "bool" ? (v ? f.yes! : f.no!) : valueText(f, v, L);
      return `<div class="rulez-log__line"><span class="rulez-log__time">${esc(f.label)}</span><span class="rulez-log__text">${esc(text)}</span></div>`;
    })
    .join("");

  const part = (title: string, body: string) => `<div class="rulez__divider">${title}</div><div class="rulez-log__part">${body}</div>`;
  return (
    part("What ran", ran) +
    part("Last ran", last || `<p class="rulez__empty">No rules yet.</p>`) +
    part("Holding now", holding.join("") || `<p class="rulez__empty">No While rule holds a value now.</p>`) +
    part("Facts now", facts)
  );
}
