// Is the dev telemetry (frames.ts, perf.ts, vinyl.ts) compiled in?
//
// Normally it rides `import.meta.env.DEV`, so the installed build carries none of it. But the
// dev server is a poor stand-in for the live app when the question is GRAPHICS: vite serves
// unbundled modules and injects CSS as many separate <style> tags, which changes style-recalc
// and script cost, and dev auto-opens DevTools, which renders its own UI in the SAME GPU
// process (the single largest distortion found on 2026-09-16).
//
// `VITE_PERF=1` keeps the telemetry in a RELEASE-SHAPED bundle — minified, one stylesheet, no
// HMR — so the ruler is present while everything else matches what ships. That is what
// `npm run dev:app -- --built` builds. A real release never sets the flag (`scripts/release.mjs`
// does not), and `npm run release:check` asserts the shipped bundle carries no telemetry.
export const TELEMETRY: boolean = import.meta.env.DEV || import.meta.env.VITE_PERF === "1";
