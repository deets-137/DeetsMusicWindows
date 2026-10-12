// The settings Rust owns (src-tauri/src/settings.rs `SettingsData`, serialized camelCase), as
// `settings_get` and every `settings_set_*` return them. One shape for every reader
// (2026-10-11): before, five files each wrote their own part of it by hand, and a rename in Rust
// left them reading `undefined` with tsc content. tests/rust-settings.test.ts reads the Rust
// struct and fails when a field is added, renamed or removed on one side only, or when an
// `Option` is not `| null` here. Types only: every reader imports it with `import type`.

/** settings.rs `AirplayCapture`. */
export type AirplayCapture = "app" | "system";
/** settings.rs `PostMode`. */
export type PostMode = "ask" | "now" | "time";

/** settings.rs `AirplaySpeaker`. */
export interface AirplaySpeaker {
  name: string;
  ip: string;
  port: number;
}

export interface RustSettings {
  airplayCapture: AirplayCapture;
  airplayLastSpeaker: AirplaySpeaker | null;
  airplayFirewallExe: string | null;
  airplaySpeakerVolumes: Record<string, number>;
  airplaySpeakerLatencyMs: Record<string, number>;
  minimizeToTray: boolean;
  agentControl: boolean;
  agentHistory: boolean;
  agentDiary: boolean;
  autostartSeeded: boolean;
  readWindowsMedia: boolean;
  bridgeToken: string;
  windowPos: [number, number] | null;
  lastfmScrobble: boolean;
  lastfmNowPlaying: boolean;
  sotd: boolean;
  sotdDayStart: number;
  sotdPicksPerDay: number;
  sotdPostMode: PostMode;
  sotdPostAt: string;
  sotdPostAs: string;
}
