// Apple Music auth bridge (frontend half).
//
// Auth runs in the user's default browser via a Rust loopback server (the in-app
// webview can't open OAuth popups). This module just drives the Rust commands;
// the Music User Token lives in Rust and never enters the renderer.

import { invoke } from "@tauri-apps/api/core";

export async function isConnected(): Promise<boolean> {
  try {
    return await invoke<boolean>("apple_connection_status");
  } catch {
    return false;
  }
}

export async function disconnect(): Promise<void> {
  await invoke("apple_disconnect");
}

/** Dev-only: dump a raw sample of the library to dev-dumps/. Returns a summary. */
export async function dumpLibrary(): Promise<string> {
  return invoke<string>("apple_dump_library");
}

/**
 * Open the system browser to sign in, then poll until Rust captures the token.
 * Resolves when connected; rejects on timeout.
 */
export async function connect(timeoutMs = 5 * 60 * 1000): Promise<void> {
  // Pass the active theme/skin so the browser sign-in page matches the app.
  const theme = document.documentElement.dataset.theme ?? "fairy";
  const skin = document.documentElement.dataset.skin ?? "vanilla";
  await invoke("apple_begin_auth", { theme, skin }); // serves the page + opens the default browser
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1200));
    if (await isConnected()) return;
  }
  throw new Error("Timed out waiting for browser sign-in");
}
