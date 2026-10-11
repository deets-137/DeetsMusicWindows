// settings-repair.ts: the words for settings.json values that reset at launch (2026-10-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { repairText } from "../src/settings-repair.ts";

test("names the rows that reset, in the words of their Settings rows (2026-10-11)", () => {
  assert.equal(repairText({ unreadable: false, fields: ["sotdPostMode"] }), "A setting could not be read, so it is back to its default: Post my picks.");
  assert.equal(
    repairText({ unreadable: false, fields: ["lastfmScrobble", "sotdPostMode", "minimizeToTray"] }),
    "Some settings could not be read, so they are back to their defaults: Scrobble plays, Post my picks and Close to tray.",
  );
});

test("a new pairing code asks to pair the extension again", () => {
  assert.equal(repairText({ unreadable: false, fields: ["bridgeToken"] }), "The browser extension's pairing code could not be read, so it is a new one. Pair the browser extension again.");
  assert.match(repairText({ unreadable: false, fields: ["agentControl", "bridgeToken"] })!, /Agent control\. Pair the browser extension again\.$/);
  assert.match(repairText({ unreadable: true, fields: [] })!, /^The settings file could not be read.*Pair the browser extension again\.$/);
});

test("nothing to say when only bookkeeping reset, or nothing did", () => {
  assert.equal(repairText({ unreadable: false, fields: ["autostartSeeded", "airplayFirewallExe"] }), null);
  assert.equal(repairText(null), null);
  assert.equal(repairText({ unreadable: false, fields: [] }), null);
});
