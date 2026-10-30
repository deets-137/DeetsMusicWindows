import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { releaseEntries, releaseLeads, versionAfter } from "./src/release-leads";

/** The first release the update card shows (docs/features/UPDATE-CARD.md §1.1, his call 11): no
 *  user ran a version before 1.0. */
const ENTRIES_FROM = "1.0.0";

/** `virtual:release-notes` (docs/features/UpdatesButton.md §3.4): the installed version's bold
 *  leads from RELEASE-NOTES.md, put in the bundle so What's new needs no network call. The
 *  entry is written before the build (RELEASE.md §0 step 1); a version with no entry gives [].
 *  `virtual:release-entries` (UPDATE-CARD.md §3.1): every entry from 1.0.0 up to the installed
 *  version, for the update card; the card imports it when it opens, so the launch does not
 *  carry it.
 *  Used by vite.config.ts and vite.demo.config.ts: the demo runs the real src/, which imports
 *  it (the 0.29.0 publish's demo build failed without it, 2026-10-16). */
export function releaseNotesPlugin(): Plugin {
  const id = "virtual:release-notes";
  const all = "virtual:release-entries";
  return {
    name: "deets-release-notes",
    resolveId: (s) => (s === id || s === all ? `\0${s}` : null),
    load(s) {
      if (s !== `\0${id}` && s !== `\0${all}`) return null;
      const version: string = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
      // Absolute: a relative watch file reads as an import of the virtual module in dev.
      const notes = resolve("docs/ops/RELEASE-NOTES.md");
      this.addWatchFile(notes);
      const entries = releaseEntries(readFileSync(notes, "utf8"));
      if (s === `\0${all}`) {
        const shown = entries.filter((e) => !versionAfter(ENTRIES_FROM, e.version) && !versionAfter(e.version, version) && !e.version.includes("-"));
        return `export default ${JSON.stringify(shown)};`;
      }
      const entry = entries.find((e) => e.version === version);
      return `export default ${JSON.stringify({ version, leads: entry ? releaseLeads(entry.body) : [] })};`;
    },
  };
}
