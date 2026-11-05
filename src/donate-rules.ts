// The Donate panel's fill rule (docs/ideas/donations.md §1), pure so tests/donate-rules.test.ts
// can read it. Donations fill the goals top to bottom: a goal gets money only after every goal
// above it is full.

/** What each goal holds: `tops` are the goals' full amounts, in panel order. */
export function fillGoals(tops: number[], dollars: number): number[] {
  let left = Math.max(0, dollars);
  return tops.map((top) => {
    const held = Math.min(left, top);
    left -= held;
    return held;
  });
}
