// Is this failed background read only a dropped connection? (2026-11-08, his call.) The answer sets
// the log level: a drop is a warning, anything else an error, so the admin page's error list holds
// real faults. The drops are still counted, as `apple.<group>.net` (APPLE-CALLS.md §2). Pure, so it
// has a unit test (tests/net-drop.test.ts).

// reqwest's own words for "no answer came" (Kind::Request, Kind::Body in its error.rs). A timeout
// is a Kind::Request. Decode is left out: a reply that came but could not be read is a fault.
const NO_ANSWER = /error sending request|request or response body error/;
// A sync joins its failed pages, so one text can hold both: an HTTP status from Apple is a fault.
const APPLE_ANSWERED = /\bHTTP \d{3}\b/;

export function isNetDrop(e: unknown): boolean {
  const text = String(e instanceof Error ? e.message : e);
  return NO_ANSWER.test(text) && !APPLE_ANSWERED.test(text);
}
