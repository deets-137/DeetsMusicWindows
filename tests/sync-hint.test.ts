// sync-hint.ts: the Library ⟳'s hover hint while a sync runs (ideas/apple-calls.md §4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncHint, nextSyncStatus, IDLE_HINT, type SyncStatus } from "../src/sync-hint.ts";

const run = (events: Parameters<typeof nextSyncStatus>[1][]): SyncStatus | null =>
  events.reduce<SyncStatus | null>((s, e) => nextSyncStatus(s, e), null);

test("no sync: the idle words", () => {
  assert.equal(syncHint(null), IDLE_HINT);
});

test("a full pass counts the songs read, then finishes up while the artist pass runs", () => {
  assert.equal(syncHint(run([{ phase: "start" }])), "Reading your library…");
  const reading = run([{ phase: "start" }, { phase: "progress", kind: "full", fetched: 1200, total: 4042 }]);
  assert.equal(syncHint(reading), `Reading your library… ${(1200).toLocaleString()} of ${(4042).toLocaleString()} songs`);
  const last = run([{ phase: "start" }, { phase: "progress", kind: "full", fetched: 4042, total: 4042 }]);
  assert.equal(syncHint(last), "Finishing up your library…");
});

// The reason `kind` rides the event: an incremental pass's `fetched` is the new songs only,
// so "3 of 4,042" would have read as if the sync had barely started.
test("2026-10-17 an incremental pass says new songs, never 'of' the total", () => {
  const none = run([{ phase: "start" }, { phase: "progress", kind: "incremental", fetched: 0, total: 4042 }]);
  assert.equal(syncHint(none), "Checking for new songs…");
  const three = run([{ phase: "start" }, { phase: "progress", kind: "incremental", fetched: 3, total: 4042 }]);
  assert.equal(syncHint(three), "Checking for new songs… 3 new");
});

test("done and error finish up; idle ends the sync", () => {
  const done = run([{ phase: "start" }, { phase: "progress", kind: "incremental", fetched: 3, total: 4042 }, { phase: "done" }]);
  assert.equal(syncHint(done), "Finishing up your library…");
  assert.equal(syncHint(run([{ phase: "start" }, { phase: "error" }])), "Finishing up your library…");
  assert.equal(run([{ phase: "start" }, { phase: "done" }, { phase: "idle" }]), null);
});

test("an incremental pass that turns into a full one reads the full words", () => {
  const s = run([
    { phase: "start" },
    { phase: "progress", kind: "incremental", fetched: 2, total: 4042 },
    { phase: "progress", kind: "full", fetched: 100, total: 4042 },
  ]);
  assert.equal(syncHint(s), `Reading your library… 100 of ${(4042).toLocaleString()} songs`);
});
