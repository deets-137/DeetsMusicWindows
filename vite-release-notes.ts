import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { releaseEntries, releaseLeads } from "./src/release-leads";

/** `virtual:release-notes` (docs/features/UpdatesButton.md §3.4): the installed version's bold
 *  leads from RELEASE-NOTES.md, put in the bundle so What's new needs no network call. The
 *  entry is written before the build (RELEASE.md §0 step 1); a version with no entry gives [].
 *  Used by vite.config.ts and vite.demo.config.ts: the demo runs the real src/, which imports
 *  it (the 0.29.0 publish's demo build failed without it, 2026-10-16). */
export function releaseNotesPlugin(): Plugin {
  const id = "virtual:release-notes";
  return {
    name: "deets-release-notes",
    resolveId: (s) => (s === id ? `\0${id}` : null),
    load(s) {
      if (s !== `\0${id}`) return null;
      const version: string = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
      // Absolute: a relative watch file reads as an import of the virtual module in dev.
      const notes = resolve("docs/ops/RELEASE-NOTES.md");
      this.addWatchFile(notes);
      const entry = releaseEntries(readFileSync(notes, "utf8")).find((e) => e.version === version);
      return `export default ${JSON.stringify({ version, leads: entry ? releaseLeads(entry.body) : [] })};`;
    },
  };
}
