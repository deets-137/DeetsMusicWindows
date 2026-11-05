import { test } from "node:test";
import assert from "node:assert/strict";
import { pressReader, type Timers } from "../src/press-read";

/** A clock the test moves by hand. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      due.set(next, { at: now + ms, fn });
      return next++;
    },
    clear: (id) => void due.delete(id as number),
  };
  const tick = (ms: number) => {
    now += ms;
    for (const [id, t] of [...due]) {
      if (t.at <= now) {
        due.delete(id);
        t.fn();
      }
    }
  };
  return { timers, tick };
}

const setup = () => {
  const { timers, tick } = fakeTimers();
  const ran: string[] = [];
  const reader = pressReader<string>(timers);
  const press = (key: string, click = "open", double = "play", wait = 250) =>
    reader.press({ key, click, double, wait, run: (v) => ran.push(`${key}:${v}`) });
  return { reader, press, ran, tick };
};

test("double-click (2026-11-04): the same verb acts at once, with no wait", () => {
  const { press, ran } = setup();
  assert.equal(press("a", "play", "play"), "click");
  assert.deepEqual(ran, ["a:play"]);
});

test("double-click (2026-11-04): two verbs, one press: the click runs after the wait", () => {
  const { press, ran, tick } = setup();
  assert.equal(press("a"), "held");
  tick(249);
  assert.deepEqual(ran, []);
  tick(1);
  assert.deepEqual(ran, ["a:open"]);
});

test("double-click (2026-11-04): a second press in the wait runs only the double-click", () => {
  const { press, ran, tick } = setup();
  press("a");
  tick(100);
  assert.equal(press("a"), "double");
  tick(1000);
  assert.deepEqual(ran, ["a:play"]);
});

test("double-click (2026-11-04): a second press after the wait is a new click", () => {
  const { press, ran, tick } = setup();
  press("a");
  tick(300);
  assert.equal(press("a"), "held");
  tick(250);
  assert.deepEqual(ran, ["a:open", "a:open"]);
});

test("double-click (2026-11-04): a press on another tile runs the waiting click first", () => {
  const { press, ran, tick } = setup();
  press("a");
  tick(100);
  press("b", "play", "play");
  assert.deepEqual(ran, ["a:open", "b:play"]);
  tick(1000);
  assert.deepEqual(ran, ["a:open", "b:play"]);
});

test("double-click (2026-11-04): a cancel drops the waiting click", () => {
  const { reader, press, ran, tick } = setup();
  press("a");
  reader.cancel();
  tick(1000);
  assert.deepEqual(ran, []);
});

test("double-click (2026-11-04): an Open acts at once, with nothing held", () => {
  const { reader, ran, tick } = setup();
  const r = reader.press({ key: "a", click: "open", double: "play", wait: 250, openFirst: true, run: (v) => ran.push(`a:${v}`) });
  assert.equal(r, "eager");
  assert.deepEqual(ran, ["a:open"]);
  tick(1000);
  assert.deepEqual(ran, ["a:open"]);
});

test("double-click (2026-11-04): an Open with the same verb on both is a plain click", () => {
  const { reader, ran } = setup();
  const r = reader.press({ key: "a", click: "open", double: "open", wait: 250, openFirst: true, run: (v) => ran.push(`a:${v}`) });
  assert.equal(r, "click");
  assert.deepEqual(ran, ["a:open"]);
});

test("double-click (2026-11-04): a wait of zero never holds a click", () => {
  const { press, ran } = setup();
  assert.equal(press("a", "open", "play", 0), "click");
  assert.deepEqual(ran, ["a:open"]);
});
