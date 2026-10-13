/// <reference types="vite/client" />

/** The app version, from package.json (vite.demo.config.ts `define`). */
declare const __DEMO_VERSION__: string;

/** The owner's Songs of the Day, copied from the feed at build time (vite.demo.config.ts). */
declare module "virtual:sotd-picks" {
  const picks: import("./catalog").FeedRow[];
  export default picks;
}
