// plain-error.ts: a toast shows an error's words only when they were written for a person
// (2026-09-29, raw system text in the rooms / friends / Compass toasts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainError } from "../src/plain-error.ts";

const FB = "Couldn't do that. Try again.";

test("words written for a person are kept", () => {
  for (const m of [
    "That is not a friend code.",
    "They are already on your list.",
    "10 friends is the most the list holds.",
    "Nothing found for “Radiohead”",
    "The web had no songs to pick",
    "Apple Music has nothing to start a web from here.",
  ]) assert.equal(plainError(new Error(m), FB), m);
  assert.equal(plainError("That is your own code.", FB), "That is your own code.");
});

test("system text gets the plain sentence (2026-09-29)", () => {
  for (const m of [
    "Failed to fetch",
    "TypeError: Failed to fetch",
    "Access is denied. (os error 5)",
    "friends: no data dir yet",
    "not connected to Apple Music",
    "the stored key is unreadable (Invalid padding)",
    "error sending request for url",
    "",
  ]) assert.equal(plainError(new Error(m), FB), FB, m);
  assert.equal(plainError(undefined, FB), FB);
  assert.equal(plainError(new TypeError("Load failed"), FB), FB);
});
