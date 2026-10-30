// The pure half of the updater (updater.ts; RELEASE.md §6.3–6.5, VELOPACK.md). No Tauri and no
// DOM here, so tests/update-rules.test.ts pins the rules.

/** -1 / 0 / 1 on x.y.z; a pre-release sorts before its release. Pre-release tags compare part by
 *  part on the dots, numbers as numbers (semver §11, the Worker's rule in DeetsSupport update.js),
 *  so beta.10 comes after beta.9. Unparseable = equal. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim());
    return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] ?? null } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  const p = x.pre.split("."), q = y.pre.split(".");
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    if (p[i] === q[i]) continue;
    const pn = /^\d+$/.test(p[i]), qn = /^\d+$/.test(q[i]);
    if (pn && qn) return +p[i] < +q[i] ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

/** The skip a rollback leaves behind. Automatic must not reinstall the version you left, nor
 *  anything newer you had already skipped: the offer is always the newest version, so the skip
 *  keeps the newer of the two. Since Velopack a downloaded version installs at the next start
 *  (VELOPACK.md §1, F1 A), so a lost skip is an install, not a question (desk test 2026-10-15:
 *  a rollback from beta.3 replaced a skip of beta.4, and the next start would have taken beta.4). */
export function rollbackSkip(skipWas: string, leaving: string): string {
  return skipWas && compareVersions(skipWas, leaving) > 0 ? skipWas : leaving;
}

/**
 * Does the Updates panel open by itself at this launch (UPDATE-CARD.md §3.10, his call 9)?
 * `last` is the version the app ran last ("" on a fresh install: never). Only after an update
 * (a rollback or the same version: never). By default only when the major or minor number
 * changed (1.2.X → 1.3.0, not 1.2.1 → 1.2.4) AND a version in the range (after `last`, up to
 * `now`) brought a new setting or a changed default. `everyUpdate` (the What's new toggle):
 * after every update, patch or not, with or without a setting.
 */
/**
 * The versions of the default changes that still have something to offer this user (UPDATE-CARD.md
 * §3.4, his call 12): their value is still the old default. A user who picked another value, or
 * already has the new one, is not told. The app never changes the value itself.
 */
export function offeredDefaultVersions(
  changes: readonly { since: string; key: string; from: unknown }[],
  valueOf: (key: string) => unknown,
): string[] {
  return changes.filter((c) => JSON.stringify(valueOf(c.key)) === JSON.stringify(c.from)).map((c) => c.since);
}

export function opensWhatsNew(last: string, now: string, settingVersions: string[], everyUpdate: boolean): boolean {
  if (!last || compareVersions(last, now) >= 0) return false;
  if (everyUpdate) return true;
  const mm = (v: string) => /^(\d+)\.(\d+)\./.exec(v.trim())?.slice(1, 3).join(".") ?? "";
  if (mm(last) === mm(now)) return false;
  return settingVersions.some((v) => compareVersions(v, last) > 0 && compareVersions(v, now) <= 0);
}
