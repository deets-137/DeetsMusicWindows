// The release notes' bold leads (docs/ideas/UpdatesButton.md §6.3): the start of each paragraph
// in a RELEASE-NOTES.md entry, in bold, is also its bullet in the updates panel's What's new.
// Pure, with no imports: the updates panel reads it, the Vite build reads it to put the
// installed version's leads in the bundle, and docs:check reads it (Node strips the types).

/** The lead rule holds for every entry after this version (§6.3: the release that ships the
 *  panel). Older entries stay as they were written. */
export const LEAD_RULE_AFTER = "0.28.0";

/** "Fixes" may close an entry; the panel leaves it out (a fix list is not news). */
const FIXES = /^fixes\.?$/i;

/** A word-count range for a lead (§6.3 rule 4: about 2 to 8 words). The check allows a little
 *  either side: one word is a category ("Lists."), and past 10 it is a sentence again. */
const MIN_WORDS = 2;
const MAX_WORDS = 10;

/** Compare two dotted versions ("0.28.0" < "0.29.0"); a pre-release tail is ignored. */
export function versionAfter(a: string, b: string): boolean {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

export interface ReleaseEntry {
  version: string;
  date: string;
  /** The text the update offer shows: up to the first `###` or the next entry. */
  body: string;
}

/** Every `## <version> — <date>` entry of RELEASE-NOTES.md, newest first, each body cut at its
 *  first `###` (the part `release:publish` copies into the update index). */
export function releaseEntries(md: string): ReleaseEntry[] {
  const text = md.replace(/\r\n/g, "\n");
  const out: ReleaseEntry[] = [];
  const heads = [...text.matchAll(/^## (\d+\.\d+\.\d+[\w.-]*) — (\S+)[^\n]*$/gm)];
  heads.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index! : text.length;
    const body = text.slice(start, end).split(/^### /m)[0].trim();
    out.push({ version: m[1], date: m[2], body });
  });
  return out;
}

/** The bold lead of each paragraph, in order. A paragraph that does not start in bold gives
 *  none. A closing period is dropped, and "Fixes" is left out. */
export function releaseLeads(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => /^\*\*([^*]+?)\*\*/.exec(p.trim())?.[1].trim() ?? "")
    .filter((l) => l && !FIXES.test(l))
    .map((l) => l.replace(/\.$/, ""));
}

/** What breaks the lead rule in one entry (§6.3), for docs:check. A paragraph with no bold
 *  lead, a lead of fewer than 2 or more than 10 words, and "Fixes" anywhere but last. */
export function leadFaults(body: string): string[] {
  const paras = body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const faults: string[] = [];
  paras.forEach((p, i) => {
    const lead = /^\*\*([^*]+?)\*\*/.exec(p)?.[1].trim();
    if (!lead) return faults.push(`a paragraph has no bold lead: "${p.slice(0, 40)}…"`);
    if (FIXES.test(lead)) {
      if (i !== paras.length - 1) faults.push(`"${lead}" must be the last paragraph`);
      return;
    }
    const words = lead.replace(/\.$/, "").split(/\s+/).filter((w) => w !== "|").length;
    if (words < MIN_WORDS) faults.push(`the lead "${lead}" is one word; say what changed`);
    if (words > MAX_WORDS) faults.push(`the lead "${lead}" has ${words} words; keep it to about 8`);
  });
  return faults;
}
