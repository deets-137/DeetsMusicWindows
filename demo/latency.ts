// The replay of the owner's waits (docs/guide/LOADING-SET.md §3.3). Only when the shots runner
// asks: it puts `window.__deetsLatency` in the page before the app loads (`--latency p50|p90|max`),
// already cut to one cold and one warm value per command from docs/guide/latency.json. The public
// demo never has it, so it answers at once, as before.
//
// The first call of a command in a page life waits the COLD value; later calls wait the WARM
// one (each falls back to the other when the profile has only one). A command with no row
// answers at once, and the console says so once (`latency: no profile for x`), so a new command
// shows up in the shot's console file. Each wait marks the page clock as the dev app's recorder
// does (`ipc:<cmd>:begin` / `:end`, src/ipc-timing.ts), so a strip names it.
//
// Covers are held by the runner itself (CDP Fetch), not here: an <img> never passes this shim.

import { mark } from "../src/marks";

type Replay = { mode: string; commands: Record<string, { cold?: number; warm?: number }> };
declare global {
  interface Window {
    __deetsLatency?: Replay;
  }
}

// Calls the dev app's recorder does not time (the window and app plugins call core from
// node_modules; the log writes are skipped on purpose), so a missing row is expected: no note.
// A plugin call made from src/ IS timed, and replays when the profile has its row.
const untimed = (cmd: string): boolean => cmd.startsWith("plugin:") || cmd === "log_event" || cmd === "diag_flush";

const seen = new Set<string>();
const missing = new Set<string>();
let seq = 0;

/** `answer` after the command's replayed wait, or at once with no replay. */
export function replayed<T>(cmd: string, answer: () => T | Promise<T>): T | Promise<T> {
  const replay = window.__deetsLatency;
  if (!replay) return answer();
  const row = replay.commands[cmd];
  if (!row) {
    if (!untimed(cmd) && !missing.has(cmd)) {
      missing.add(cmd);
      console.info(`latency: no profile for ${cmd}`);
    }
    return answer();
  }
  const first = !seen.has(cmd);
  seen.add(cmd);
  const ms = (first ? row.cold ?? row.warm : row.warm ?? row.cold) ?? 0;
  const id = String(++seq);
  mark(`ipc:${cmd}:begin`, id);
  return new Promise<T>((ok, fail) =>
    setTimeout(() => {
      Promise.resolve()
        .then(answer)
        .then(ok, fail)
        .finally(() => mark(`ipc:${cmd}:end`, id));
    }, ms),
  );
}
