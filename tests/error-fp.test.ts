// An error's fingerprint (USAGE-COUNTS.md §16, his call 1A, 2026-10-30): the type and the place,
// never the message.
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorFp, framePlace, errorName, FP_RULE } from "../src/error-fp.ts";

const ORIGIN = "http://tauri.localhost";

test("error fp (2026-10-30): a frame's place drops the build hash and the dev query", () => {
  assert.equal(framePlace("    at L9.window.fetch (http://tauri.localhost/assets/main-BAWGLJv6.js:2:4439)"), "main.js:2:4439");
  assert.equal(framePlace("    at x (http://tauri.localhost/assets/settings-card-B-WGLJv6.js:1:99)"), "settings-card.js:1:99");
  assert.equal(framePlace("    at http://localhost:1420/src/player.ts?t=1730300000:412:3"), "player.ts:412:3");
  assert.equal(framePlace("    at n (https://js-cdn.music.apple.com/musickit/v3/musickit.js:28:6351)"), "musickit.js:28:6351");
  assert.equal(framePlace("    at <anonymous>"), null);
});

test("error fp (2026-10-30): the live 'Failed to fetch' names our frame, then MusicKit's", () => {
  const e = new TypeError("Failed to fetch");
  const stack = [
    "TypeError: Failed to fetch",
    "    at L9.window.fetch (http://tauri.localhost/assets/main-BAWGLJv6.js:2:4439)",
    "    at Eee.window.fetch (http://tauri.localhost/assets/main-BAWGLJv6.js:64:37497)",
    "    at n (https://js-cdn.music.apple.com/musickit/v3/musickit.js:28:6351)",
  ].join("\n");
  assert.equal(errorFp("rejection", e, stack, { origin: ORIGIN }), "rejection.TypeError@main.js:2:4439<musickit.js:28:6351");
});

test("error fp (2026-10-30): the message never reaches it, whatever it holds", () => {
  const e = new Error("Couldn't play “My Breakup Songs” from C:\\Users\\someone");
  const fp = errorFp("window", e, "Error: x\n    at f (http://tauri.localhost/assets/main-AAAAAAAA.js:1:2)", { origin: ORIGIN });
  assert.equal(fp, "window.Error@main.js:1:2");
  assert.ok(!fp.includes("Breakup") && !fp.includes("someone"));
});

test("error fp (2026-10-30): no stack uses the fallback, then 'unknown'", () => {
  assert.equal(errorFp("window", new RangeError("x"), undefined, { fallback: "http://tauri.localhost/assets/main-AAAAAAAA.js:3:9" }), "window.RangeError@main.js:3:9");
  assert.equal(errorFp("rejection", "a plain string", undefined), "rejection.String@unknown");
  assert.equal(errorFp("rejection", { name: "Not a name!" }, undefined), "rejection.Value@unknown");
});

test("error fp (2026-10-30): the console hook's own frame is skipped", () => {
  const stack = [
    "Error",
    "    at console.error (http://tauri.localhost/assets/main-AAAAAAAA.js:9:100)",
    "    at save (http://tauri.localhost/assets/main-AAAAAAAA.js:40:7)",
  ].join("\n");
  assert.equal(errorFp("console", "Console", stack, { origin: ORIGIN, skip: 1 }), "console.String@main.js:40:7");
});

test("error fp (2026-10-30): every result passes the shared rule", () => {
  assert.equal(errorName(new TypeError()), "TypeError");
  for (const fp of ["window.TypeError@main.js:2:4439", "rejection.MKError@musickit.js:28:6351", "console.Console@unknown"]) {
    assert.ok(FP_RULE.test(fp), fp);
  }
});
