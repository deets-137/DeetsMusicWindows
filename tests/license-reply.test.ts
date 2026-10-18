import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLicenseReply, isRefusal, errorFields, compactEvent } from "../src/license-reply";

// The good reply read on the dev app, 2026-10-18 (the license value shortened).
const GOOD = JSON.stringify({ license: "CAIS...", errorCode: 0, "renew-after": 780, status: 0 });

test("a good license reply reads as a license, and the key is never kept (2026-10-18)", () => {
  const r = parseLicenseReply(GOOD);
  assert.deepEqual(r, { status: 0, errorCode: 0, renewAfter: 780, hasLicense: true });
  assert.equal(isRefusal(200, r), false);
  assert.equal(JSON.stringify(r).includes("CAIS"), false);
});

test("a refusal is an HTTP error, a nonzero code or no license (2026-10-18)", () => {
  assert.equal(isRefusal(500, parseLicenseReply(GOOD)), true);
  assert.equal(isRefusal(200, parseLicenseReply(JSON.stringify({ status: -1021, errorCode: -1021 }))), true);
  assert.equal(isRefusal(200, parseLicenseReply(JSON.stringify({ license: "x", status: 0, errorCode: 5 }))), true);
  assert.equal(isRefusal(200, parseLicenseReply(JSON.stringify({ status: 0, errorCode: 0 }))), true); // no license
  const html = parseLicenseReply("<html>\n  <body>Service Unavailable</body></html>");
  assert.equal(html.status, null);
  assert.equal(html.text, "<html> <body>Service Unavailable</body></html>");
  assert.equal(isRefusal(200, html), true);
  assert.equal(parseLicenseReply(JSON.stringify({ status: "-1004" })).status, -1004); // a number as text
});

test("MusicKit's error object is logged without its secrets (2026-10-18)", () => {
  // The shape the forced refusal raised on the dev app.
  const e = {
    name: "WIDEVINE_CDM_EXPIRED",
    reason: "WIDEVINE_CDM_EXPIRED",
    description: "MEDIA_LICENSE",
    errorCode: "WIDEVINE_CDM_EXPIRED",
    data: { status: 190121, errorCode: -1021, message: "x", license: "SECRET", musicUserToken: "SECRET", nested: { authToken: "SECRET", ok: 1 } },
    message: "MEDIA_LICENSE",
  };
  const f = errorFields(e);
  assert.equal(f.name, "WIDEVINE_CDM_EXPIRED");
  assert.deepEqual((f.data as Record<string, unknown>).status, 190121);
  assert.equal(JSON.stringify(f).includes("SECRET"), false);
  assert.deepEqual((f.data as any).nested, { ok: 1 });
  assert.deepEqual(errorFields("MEDIA_LICENSE"), {});
  const long = errorFields({ description: "y".repeat(5000), data: { a: "z".repeat(5000), b: "z".repeat(5000), c: "z".repeat(5000), d: "z".repeat(5000) } });
  assert.ok(JSON.stringify(long).length <= 600);
});

test("a license event fits in a few characters for the log line (2026-10-18)", () => {
  assert.equal(compactEvent(2300.4, { kind: "req", http: 200, status: 0, errorCode: 0, renewAfter: 780, ms: 630 }), "-2300 req 200 s0 e0 r780 630ms");
  assert.equal(compactEvent(90, { kind: "req", http: 200, status: -1021, errorCode: -1021, refused: true, ms: 30 }), "-90 req 200 s-1021 e-1021 REFUSED 30ms");
  assert.equal(compactEvent(40, { kind: "msg", id: 3, type: "license-renewal" }), "-40 msg#3 license-renewal");
  assert.equal(compactEvent(5, { kind: "keys", id: 3, keys: ["expired"], expiresIn: 0 }), "-5 keys#3 expired 0s");
  assert.equal(compactEvent(-3, { kind: "session", id: 1, type: "temporary" }), "-0 session#1 temporary");
});
