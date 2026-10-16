/// <reference types="vite/client" />

/** The installed version's What's new leads (vite.config.ts, docs/features/UpdatesButton.md §3.4). */
declare module "virtual:release-notes" {
  const notes: { version: string; leads: string[] };
  export default notes;
}
