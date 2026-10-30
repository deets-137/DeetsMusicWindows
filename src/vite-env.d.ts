/// <reference types="vite/client" />

/** The installed version's What's new leads (vite.config.ts, docs/features/UpdatesButton.md §3.4). */
declare module "virtual:release-notes" {
  const notes: { version: string; leads: string[] };
  export default notes;
}

/** Every release entry from 1.0.0 to the installed version, newest first (vite-release-notes.ts,
 *  docs/features/UPDATE-CARD.md §3.1). The update card imports it when it opens. */
declare module "virtual:release-entries" {
  const entries: { version: string; date: string; body: string }[];
  export default entries;
}
