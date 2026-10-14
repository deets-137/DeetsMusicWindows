// The rooms port's entry (docs/features/WebRooms.md §9.3 B). The Tauri stand-in must exist before
// any module of `src/` loads, because some of them call Rust at import time (boot-prefetch.ts).
// So this file installs it first, with the port's own back end, and only then loads the cards.
// The two imports here have no `src/` code that runs on load.

import { installTauri } from "./tauri-shim";
import { handle } from "./handlers";

installTauri(handle);
await import("./app");
