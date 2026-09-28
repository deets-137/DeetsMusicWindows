// Dev-only timeline marks for the shots runner (docs/guide/SHOTS.md §5f). A mark is one named
// moment on the page's own clock (epoch ms, `performance.timeOrigin + now`), so the runner can
// print it on the frame where it happened: a panel closing, a fade's snapshot, a window of
// frames.ts opening. Gated on TELEMETRY like frames.ts: the installed build ships none of it
// (release-check item 5 greps for `__marks`).
//
// Marks sit at generic places, so most gestures get them for free: every frames.ts window
// (`<name>:begin` / `<name>:end`), every makeDropdown panel (`panel:open` / `panel:close`), the
// theme fade and the cover (appearance.ts). A new mark is one `mark()` call.

import { TELEMETRY } from "./telemetry-on";

type Mark = { t: number; name: string; detail: string };
const CAP = 4000; // the dev app runs for hours; keep the newest

export function mark(name: string, detail = ""): void {
  if (!TELEMETRY) return;
  const w = window as unknown as { __marks?: Mark[] };
  const list = (w.__marks ??= []);
  list.push({ t: performance.timeOrigin + performance.now(), name, detail });
  if (list.length > CAP) list.splice(0, list.length - CAP);
}
