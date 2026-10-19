// net-rules.ts: the Network panel's verdicts, the title, the fetch wrap's host test and piece
// speed (docs/features/speedtest.md §8). Built 2026-10-19.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyMinute, median, lossOf, internetVerdict, wifiVerdict, appleVerdict, streamVerdict, airplayVerdict,
  worst, titleVerdict, testVerdict, isSongUrl, pieceKbps, pushRing, type Minute,
} from "../src/net-rules.ts";

const min = (over: Partial<Minute>): Minute => ({ ...emptyMinute(1), ...over });

test("median of an odd and an even list, and of none (2026-10-19)", () => {
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), null);
});

test("loss is the share of echoes that did not come back (2026-10-19)", () => {
  assert.equal(lossOf({ pingSent: 6, rtts: [1, 1, 1, 1, 1, 1] }), 0);
  assert.equal(lossOf({ pingSent: 6, rtts: [1, 1, 1] }), 0.5);
  assert.equal(lossOf({ pingSent: 0, rtts: [] }), null);
});

test("internet: offline is Bad, a lost echo is OK, no ping while online is nothing (2026-10-19)", () => {
  assert.equal(internetVerdict(min({ offline: true })), "bad");
  assert.equal(internetVerdict(min({ pingSent: 6, rtts: [20, 21, 22, 20, 19] })), "ok");
  assert.equal(internetVerdict(min({ pingSent: 6, rtts: [20, 21, 22] })), "bad");
  assert.equal(internetVerdict(min({ pingSent: 6, rtts: [20, 21, 22, 20, 19, 25] })), "good");
  assert.equal(internetVerdict(min({ pingSent: 6, rtts: [300, 300, 300, 300, 300, 300] })), "bad");
  assert.equal(internetVerdict(min({ pingSent: 6, rtts: [130, 130, 130, 130, 130, 130] })), "ok");
  assert.equal(internetVerdict(min({})), "none");
  assert.equal(internetVerdict(min({ drops: 1 })), "ok");
  assert.equal(internetVerdict(min({ drops: 3 })), "bad");
});

test("wi-fi follows Windows' own bars (2026-10-19)", () => {
  assert.equal(wifiVerdict(min({ wifi: null })), "none");
  assert.equal(wifiVerdict(min({ wifi: 30 })), "bad");
  assert.equal(wifiVerdict(min({ wifi: 50 })), "ok");
  assert.equal(wifiVerdict(min({ wifi: 90 })), "good");
});

test("apple: one failure is OK, only failures or three is Bad (2026-10-19)", () => {
  assert.equal(appleVerdict(0, 0), "none");
  assert.equal(appleVerdict(5, 0), "good");
  assert.equal(appleVerdict(5, 1), "ok");
  assert.equal(appleVerdict(0, 1), "bad");
  assert.equal(appleVerdict(10, 3), "bad");
});

test("stream: a pause to load is OK, two or ten seconds is Bad (2026-10-19)", () => {
  assert.equal(streamVerdict(min({})), "none");
  assert.equal(streamVerdict(min({ playing: true })), "good");
  assert.equal(streamVerdict(min({ playing: true, stalls: 1, stallS: 2 })), "ok");
  assert.equal(streamVerdict(min({ playing: true, stalls: 1, stallS: 12 })), "bad");
  assert.equal(streamVerdict(min({ playing: true, stalls: 2, stallS: 2 })), "bad");
});

test("airplay: resends as a share of packets, gaps and a slow round trip (2026-10-19)", () => {
  assert.equal(airplayVerdict(min({})), "none");
  assert.equal(airplayVerdict(min({ apPackets: 1000, apResends: 1 })), "good");
  assert.equal(airplayVerdict(min({ apPackets: 1000, apResends: 6 })), "ok");
  assert.equal(airplayVerdict(min({ apPackets: 1000, apResends: 25 })), "bad");
  assert.equal(airplayVerdict(min({ apPackets: 1000, apStarved: 3 })), "ok");
  assert.equal(airplayVerdict(min({ apPackets: 1000, apRtt: 200 })), "ok");
});

test("the title is the worst cell of the last five minutes; offline now is Bad (2026-10-19)", () => {
  assert.equal(worst(["none", "good", "ok"]), "ok");
  assert.equal(worst([]), "none");
  const old = ["bad", "none", "none", "none", "none", "none", "good"] as const;
  assert.equal(titleVerdict([[...old]], true), "good", "a Bad cell six minutes ago is out of the window");
  assert.equal(titleVerdict([["none", "none"], ["good", "ok"]], true), "ok");
  assert.equal(titleVerdict([["none"]], true), "good", "nothing to judge reads Good");
  assert.equal(titleVerdict([["good"]], false), "bad");
});

test("the Test's tone (2026-10-19)", () => {
  assert.equal(testVerdict(0.3), "bad");
  assert.equal(testVerdict(1), "ok");
  assert.equal(testVerdict(40), "good");
});

test("the wrap reads Apple's song server only (2026-10-19)", () => {
  assert.equal(isSongUrl("https://aod-ssl.itunes.apple.com/itunes-assets/x.mp4"), true);
  assert.equal(isSongUrl("https://aod-ssl.itunes.apple.com:443/a"), true);
  assert.equal(isSongUrl("https://aod-ssl.itunes.apple.com.evil.example/a"), false);
  assert.equal(isSongUrl("https://play.itunes.apple.com/WebObjects/x"), false);
  assert.equal(isSongUrl("https://is1-ssl.mzstatic.com/aod-ssl.itunes.apple.com/"), false);
  assert.equal(isSongUrl("/relative"), false);
});

test("a piece's speed, and none for a cache hit (2026-10-19)", () => {
  assert.equal(pieceKbps(250_000, 100), 20_000);
  assert.equal(pieceKbps(250_000, 2), null);
  assert.equal(pieceKbps(0, 100), null);
  assert.equal(pieceKbps(NaN, 100), null);
});

test("the ring keeps the last items only (2026-10-19)", () => {
  const r: number[] = [];
  for (let i = 0; i < 60; i++) pushRing(r, i, 50);
  assert.equal(r.length, 50);
  assert.equal(r[0], 10);
  assert.equal(r[49], 59);
});
