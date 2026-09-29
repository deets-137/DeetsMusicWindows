// friend-pin.ts: trust a friend's key on first use (FRIENDS.md §19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeKey, pinsForWorker } from "../src/friend-pin.ts";

const A = "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=";
const B = "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=";

test("2026-09-29 the first key is pinned, the same key is trusted, a new key is not", () => {
  assert.equal(judgeKey(undefined, A), "pin");
  assert.equal(judgeKey(null, A), "pin");
  assert.equal(judgeKey(A, A), "trust");
  assert.equal(judgeKey(A, B), "changed");
});

test("2026-09-29 a message with no key is a worker from before the pin, and passes", () => {
  assert.equal(judgeKey(A, undefined), "legacy");
  assert.equal(judgeKey(A, ""), "legacy");
  assert.equal(judgeKey(undefined, 42), "legacy");
});

test("2026-09-29 whitespace around a key is the same key", () => {
  assert.equal(judgeKey(A, ` ${A}\n`), "trust");
});

test("2026-09-29 the worker gets the pinned friends only", () => {
  assert.deepEqual(
    pinsForWorker([
      { code: "ZT0JR4QK", key: A },
      { code: "ABCD2345" },
      { code: "ABCD2346", key: null },
    ]),
    { ZT0JR4QK: A },
  );
});
