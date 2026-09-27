// The rule chip (docs/architecture/RULES.md §9): a mark beside a label that a rule can set.
//   Bolt — a rule set this value now. The hover hint names the rule and your own value.
//   Hand — you changed it and the rule stands aside. The hint says when it acts again; a
//          press gives the value back to the rule at once (Resume).
// It is the New badge's family (a disc after a label). Both glyphs are placeholders: the owner
// designs the chip (RULES.md §15, R5), and this is the one file that changes then.

import { chipState, onRulesChange, resumeRule } from "./rules";

// Each view box is centred on its own glyph's box (not the 24 grid), so the glyph sits in the
// middle of the disc (his note, 2026-09-26: the first hand leaned to the lower right).
const BOLT =
  '<svg viewBox="0.5 1 22 22" aria-hidden="true"><path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" fill="currentColor"/></svg>';
const HAND =
  '<svg viewBox="0.6 1 22 22" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 5.5v-2a1.5 1.5 0 1 1 3 0V12M14 5.5a1.5 1.5 0 0 1 3 0V12M17 7.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7c-.3-.5-1.4-2.4-3.3-5.7a1.5 1.5 0 0 1 .5-2 1.9 1.9 0 0 1 2.3.3L8 13.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface RuleChip {
  el: HTMLButtonElement;
  destroy(): void;
}

/** A chip for `target` (`key:theme`, `key:soundEqPreset` …). It hides itself when no rule acts. */
export function ruleChip(target: string): RuleChip {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "rule-chip";
  el.hidden = true;
  let kind = "";
  const paint = () => {
    const s = chipState(target);
    el.hidden = !s;
    if (!s) return;
    if (s.kind !== kind) {
      kind = s.kind;
      el.dataset.kind = s.kind;
      el.innerHTML = s.kind === "bolt" ? BOLT : HAND;
    }
    el.title = s.hint;
    el.setAttribute("aria-label", s.hint);
    el.dataset.rule = s.ruleId;
  };
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = chipState(target);
    if (s?.kind === "hand") resumeRule(s.ruleId);
  });
  const unsub = onRulesChange(paint);
  paint();
  return {
    el,
    destroy() {
      unsub();
      el.remove();
    },
  };
}
