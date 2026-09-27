// The rule chip (docs/architecture/RULES.md §9): a mark beside a label that a rule can set.
//   Bolt — a rule set this value now. The hover hint names the rule and your own value.
//   Hand — you changed it and the rule stands aside. The hint says when it acts again; a
//          press gives the value back to the rule at once (Resume).
// It is the New badge's family (a disc after a label). Both glyphs are placeholders: the owner
// designs the chip (RULES.md §15, R5), and this is the one file that changes then.

import { chipState, onRulesChange, resumeRule } from "./rules";

// Both glyphs are drawn symmetric about the 24 grid's centre, with a margin on every side, so
// they sit in the middle of the disc to the eye and never touch its edge (his notes,
// 2026-09-26: the first hand leaned off centre; a hand with a thumb read as off centre and was
// cut at the bottom in the Skin row).
const BOLT =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 3L6 13.5h5.5L10.5 21 18 10.5h-5.5z" fill="currentColor"/></svg>';
const HAND =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M6.8 12V8M10.3 12V5.2M13.7 12V5.2M17.2 12V8" stroke="currentColor" stroke-width="2.7" stroke-linecap="round"/>' +
  '<path d="M5.4 11.5h13.2V14a6.6 6.6 0 0 1-13.2 0z" fill="currentColor"/></svg>';

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
