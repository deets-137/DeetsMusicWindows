// Apple's restriction flag (QUEUE.md § The real restriction flag, 2026-11-22).
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsSignIn, GUESSED_RESTRICTED } from "../src/restrict-rules";

test("2026-11-22 a user in a guessed storefront with no saved flag must sign in again", () => {
  assert.equal(needsSignIn({ flag: null, storefront: "in" }), true);
  assert.equal(needsSignIn({ flag: null, storefront: "IT" }), true); // case does not matter
  assert.equal(GUESSED_RESTRICTED.length, 14);
});

test("2026-11-22 a saved flag, or a storefront MusicKit does not guess, needs no sign-in", () => {
  assert.equal(needsSignIn({ flag: false, storefront: "in" }), false); // Apple said: allowed
  assert.equal(needsSignIn({ flag: true, storefront: "in" }), false); // Apple said: restricted, a sign-in cannot change it
  assert.equal(needsSignIn({ flag: null, storefront: "us" }), false); // MusicKit does not block here
  assert.equal(needsSignIn({ flag: null, storefront: null }), false); // no storefront known yet
});
