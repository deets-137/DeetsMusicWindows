// Which build is running (docs/features/WebRooms.md §9.3 F). The desktop app is the default.
// `WEB_ROOMS` is the rooms port on deets.solutions (`vite --mode listen`): the app's Search,
// Queue, History and Now Playing cards in a browser, joined to a DeetsMusicRooms room. A row
// that needs the desktop (the library, ♥, pins, playlists, AirPlay, Friends) reads this flag and
// is left out, not hidden: CSS cannot take a menu row out of the keyboard order.
//
// The web demo is NOT this flag: it is the whole desktop UI on a mock back end, and it keeps
// every row (WEB-DEMO.md §9: no file in src/ knows about the demo).

/** Vite sets `import.meta.env`; Node's test runner does not, so the read is guarded. */
const mode = (import.meta as { env?: { MODE?: string } }).env?.MODE;

/** True in the rooms port's web build only. */
export const WEB_ROOMS = mode === "listen";
