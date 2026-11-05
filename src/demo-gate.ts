// Demo mode's flag (docs/features/WEB-DEMO.md §17). Demo login on the hosted sign-in page sets it;
// signing out clears it. It lives in this file, away from the demo itself, so a normal launch
// carries only these few lines: the demo's code loads only with the flag (ipc-core.ts).

const KEY = "deets.demoMode";

/** The tray panel is its own page and stays on real Rust: it shows what the player publishes. */
const isPlayerPage = (): boolean => !location.pathname.includes("tray");

export function demoMode(): boolean {
  try {
    return isPlayerPage() && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Into the demo. The grand opening is over: the tester lands on the filled cards. */
export function enterDemo(): void {
  if (!isPlayerPage()) return;
  localStorage.setItem(KEY, "1");
  const settings = JSON.parse(localStorage.getItem("deets.settings") ?? "{}");
  localStorage.setItem("deets.settings", JSON.stringify({ ...settings, openingPending: false }));
  location.reload();
}

export function leaveDemo(): void {
  localStorage.removeItem(KEY);
  location.reload();
}
