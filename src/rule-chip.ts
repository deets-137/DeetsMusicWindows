// The rule chip (docs/architecture/RULES.md §9): a mark beside a label that a rule can set.
//   Green dot ("bolt") — a rule set this value now. The hover hint names the rule and your value.
//   Scarlet dot ("hand") — you changed it and the rule stands aside. The hint says when it acts
//          again; a press gives the value back to the rule at once (Resume).
// His design, 2026-09-26 (RULES.md §9). The kinds keep their old names in the code.

import { chipState, onRulesChange, resumeRule } from "./rules";
import * as diag from "./diag";

// Both states are one dot (his design, 2026-09-26); the colour tells them apart: green when a
// rule set the value (`--rule-chip-rule`), scarlet when your pick holds (`--rule-chip-hand`).
// An earlier bolt and hand read as blobs at 12 px.
const DOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>';

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
      el.innerHTML = DOT;
    }
    el.title = s.hint;
    el.setAttribute("aria-label", s.hint);
    el.dataset.rule = s.ruleId;
  };
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = chipState(target);
    if (s?.kind !== "hand") return;
    // `trusted` tells a real press from a script's .click() (a desk test), so the log says
    // which one gave the value back (2026-09-26: a real press read as a mystery).
    diag.log("ui:act", { at: "rule-chip", do: "resume", target, rule: s.ruleId, trusted: e.isTrusted });
    resumeRule(s.ruleId);
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
