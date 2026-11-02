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
  // The dev server also carries the entries above the installed version, so
  // `__updateCard.preview("1.3.0")` shows the next release's card before it is built
  // (UPDATE-CARD.md §3.13); the card itself cuts at the version it runs as. A build stops at the
  // installed version, as before.
  let serve = false;
  return {
    name: "deets-release-notes",
    configResolved: (c) => {
      serve = c.command === "serve";
    },
    resolveId: (s) => (s === id || s === all ? `\0${s}` : null),
    load(s) {
      if (s !== `\0${id}` && s !== `\0${all}`) return null;
      const version: string = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
      // Absolute: a relative watch file reads as an import of the virtual module in dev.
      const notes = resolve("docs/ops/RELEASE-NOTES.md");
      this.addWatchFile(notes);
      const entries = releaseEntries(readFileSync(notes, "utf8"));
      if (s === `\0${all}`) {
        const shown = entries.filter((e) => !versionAfter(ENTRIES_FROM, e.version) && (serve || !versionAfter(e.version, version)) && !e.version.includes("-"));
        // An intro still marked TODO never reaches a user: the release build fails on it.
        const todo = serve ? undefined : shown.find((e) => /^TODO\b/.test(e.intro ?? ""));
        if (todo) this.error(`RELEASE-NOTES.md ${todo.version}: the ### Intro still says TODO (UPDATE-CARD.md §3.13)`);
        return `export default ${JSON.stringify(shown)};`;
      }
      const entry = entries.find((e) => e.version === version);
      // `shown`: the releases he marked `### Show after update` (UPDATE-CARD.md §3.17), so the
      // launch can tell, without the entries, whether an update brought one. A few short strings.
      const shown = entries.filter((e) => e.shown && !versionAfter(ENTRIES_FROM, e.version)).map((e) => e.version);
      return `export default ${JSON.stringify({ version, leads: entry ? releaseLeads(entry.body) : [], shown })};`;
    },
  };
}
