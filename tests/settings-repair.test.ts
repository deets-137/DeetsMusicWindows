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

test("a new bridge token asks nothing, since the extension left v1 (2026-10-23)", () => {
  assert.equal(repairText({ unreadable: false, fields: ["bridgeToken"] }), null);
  assert.match(repairText({ unreadable: false, fields: ["agentControl", "bridgeToken"] })!, /: Agent control\.$/);
  assert.match(repairText({ unreadable: true, fields: [] })!, /^The settings file could not be read.*back to their defaults\.$/);
});

test("nothing to say when only bookkeeping reset, or nothing did", () => {
  assert.equal(repairText({ unreadable: false, fields: ["autostartSeeded", "airplayFirewallExe"] }), null);
  assert.equal(repairText(null), null);
  assert.equal(repairText({ unreadable: false, fields: [] }), null);
});
