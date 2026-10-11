// What to tell the user when settings.json did not read whole at launch (2026-10-11). Rust keeps
// every value it can read and resets only the ones it cannot (src-tauri/src/safe_file.rs); this
// names the reset ones in the words of their Settings rows. Pure: main.ts shows the toast.

/** `settings_load_problems` (settings.rs): the JSON names of the fields that reset. */
export interface LoadProblems {
  unreadable: boolean;
  fields: string[];
}

// The Rust fields by the name of their row (agent-settings.ts labels). Bookkeeping fields with
// no row (the first-run autostart mark, the firewall prompt's exe) are not named: the log has them.
const ROW: Record<string, string> = {
  minimizeToTray: "Close to tray",
  readWindowsMedia: "Read Windows media",
  agentControl: "Agent control",
  agentHistory: "Agents read play history",
  agentDiary: "Agents use the Diary",
  lastfmScrobble: "Scrobble plays",
  lastfmNowPlaying: "Show now playing",
  sotd: "Song of the Day",
  sotdDayStart: "Day starts at",
  sotdPicksPerDay: "Picks per day",
  sotdPostMode: "Post my picks",
  sotdPostAt: "Post at",
  sotdPostAs: "Post as",
  airplayCapture: "Send to speaker",
  airplayLastSpeaker: "the last AirPlay speaker",
  airplaySpeakerVolumes: "the AirPlay speaker volumes",
  airplaySpeakerLatencyMs: "the AirPlay speaker delays",
  windowPos: "the window's place",
};
const PAIR = "Pair the browser extension again.";

const list = (names: string[]): string =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** The toast's words, or null when nothing the user set was lost. */
export function repairText(p: LoadProblems | null | undefined): string | null {
  if (!p) return null;
  if (p.unreadable) {
    return `The settings file could not be read, so Close to tray, Agent control, Last.fm, Song of the Day and AirPlay are back to their defaults. ${PAIR}`;
  }
  const named = p.fields.map((f) => ROW[f]).filter((n): n is string => !!n);
  const token = p.fields.includes("bridgeToken");
  if (!named.length && !token) return null;
  const head = named.length
    ? `${named.length === 1 ? "A setting" : "Some settings"} could not be read, so ${named.length === 1 ? "it is" : "they are"} back to ${named.length === 1 ? "its default" : "their defaults"}: ${list(named)}.`
    : "The browser extension's pairing code could not be read, so it is a new one.";
  return token ? `${head} ${PAIR}` : head;
}
