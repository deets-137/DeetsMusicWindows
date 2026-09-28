---
status: built
desk_test: open
sources: [src/rules-eval.ts, src/rules.ts, src/rule-chip.ts, src/look.ts, src/look-ids.ts, src/settings-store.ts, src/card-grow.ts, src/look-schedule.ts, src/sleep.ts, src/sound.ts, src/presence.ts, src/friends.ts, src/layout.ts, src/collection-card.ts, src/search-card.ts, src/diary-card.ts, src/quick-panel.ts, src/playlists-card.ts]
updated: 2026-09-27
---
# DeetsMusic — the rules engine

**Designed 2026-09-26 with the owner; built the same day on branch `rules-rulez` (§17 steps
1–11, all committed). §18 is the as-built record: where it differs from §1–§17, §18 is the
code. The chip's look (§9) is still his to design; the build uses a bolt and a hand.**

A rule tells the app what to do when something happens, or while something is true. The
engine sits under the Settings rows: a row's value makes a built-in rule, and the engine runs
it. The user does not write rules yet. When the rules editor comes, it shows the same rules.
The first actions are card grows ([CARD-GROW.md §18](../cards/CARD-GROW.md)). Other actions
set settings (theme, skin, the EQ preset, sharing), keep the window on top, summon a card, and
arm the sleep timer.

Files (planned): `src/rules-eval.ts` (pure: the types, the evaluator, the built-in rules made
from settings; covered by `npm test`) · `src/rules.ts` (the registry, `emit`, the state loop,
the log) · `src/rule-chip.ts` (the chip) · `src/settings-store.ts` (the overlay, §7) · the
trigger sites (§10).

---

## 1. Terms

- **Event:** a named moment the app reports, for example `album.open`. A site reports it with
  one call.
- **Fact:** a value the engine reads when it checks a rule, for example `surface`.
- **Condition:** facts joined by all / any / not (§4).
- **Moment rule:** when an event happens and the condition is true, do an action one time.
- **State rule:** while the condition is true, set values. When it stops being true, the values
  go back.
- **Built-in rule:** a rule that a Settings row makes from its own value. The row is the truth;
  the rule is made again when the row changes.
- **Your value:** the value of a setting that you chose. It is stored on disk.
- **Effective value:** the value the app uses now: your value, unless an active state rule lays
  its own value on top.
- **Overlay:** the rule's value laid on top of your value. It never replaces your value.
- **Hand change:** you change a value that a state rule set. §8 says what the rule does then.
- **Registry:** the list of events, facts, actions and rule-settable keys. A module adds its own
  parts to it.

## 2. Decisions

| Date | Fork | Choice |
|---|---|---|
| 2026-09-24 | Storage and UI | The rules are data; Settings rows first, a rules editor later (CARD-GROW.md §18.2, fork 5C). |
| 2026-09-24 | When a rule grow ends | When Back leaves the level that caused it (fork 6A). |
| 2026-09-24 | A hand grow | A rule never changes or shrinks a grow that is on screen (fork 7A). |
| 2026-09-26 | A condition layer | Every rule can carry an `if` condition. |
| 2026-09-26 | Grow actions | `horizontal`, `vertical`, `full`, or no rule. |
| 2026-09-26 | Two rules match | The first rule in list order wins. |
| 2026-09-26 | No neighbour on that axis | The rule does nothing and logs `no-axis`. A built-in rule for Midi names the axis Midi has (below). |
| 2026-09-26 | Which neighbour | The card's natural neighbour, from `MAX_NEIGHBOR` / `MIDI_NEIGHBOR` in card-grow.ts. |
| 2026-09-26 | Scope | A general engine. More actions come later through the registry (§6). |
| 2026-09-26 | Storage format | JSON in the settings store, with a version number. Not XML (§12). |
| 2026-09-26 | How it runs | In the page, synchronously, from events at the seams. No worker thread (§10). |
| 2026-09-26 | The overlay | The safe way: `RuleKey`, `effective`, `ownSetting`, so `tsc` catches drift (§7). |
| 2026-09-26 | Show a rule's effect | A chip. Bolt = a rule set this; hand = you changed it. Placeholders: he designs the chip (§9). |
| 2026-09-26 | A hand change | Your change wins. A state rule says when it acts again: `next`, `session`, `off`, or `until` a condition (§8). |
| 2026-09-26 | Settings rows | The engine is what the rows use. **A row makes its rule** from its own value; no data moves (§13). |
| 2026-09-26 | Loops | **No rule sets off a rule.** An action never fires an event into the engine. A condition holds at most one level of groups (§4). |
| 2026-09-26 | Album and artist | One row, **Grow on album or artist**: *Vertical* (default) / *Full* / *Off*. In Midi the card grows sideways. |
| 2026-09-26 | Lib \| Full | Full is a filter on the same view, not a drill. **It does not grow a card.** A rule grow ends on Back. |
| 2026-09-26 | Theme and skin | **Move into the settings store** as `theme` and `skin` (§7a). |
| 2026-09-26 | EQ for each output | **A pick updates that output's rule** (`onHand: "learn"`, §8). Behavior as today. |
| 2026-09-26 | This branch builds | The engine and grow rules; the overlay with theme and skin; the look schedule, Keep on top, EQ for each output, the sharing pause; the summon and sleep actions. Not the rules editor (§17). |

## 3. The two kinds of rule

| Kind | Shape | Example |
|---|---|---|
| Moment | when an event + in a card + if → an action | When an album opens in Library, if the surface is Max → grow `vertical` |
| State | while a condition → set values | While the output is my headphones → EQ preset = Warm |

A moment rule acts one time and forgets. A state rule holds while its condition is true and
lets go when it ends. Only a state rule sets values, because only a state rule knows when to
give a value back.

## 4. The data shape

```ts
type Stored = { v: 1; rules: Rule[] };          // the user's own rules: empty until the editor

type Rule = MomentRule | StateRule;
type Source = { row: keyof Settings } | { user: true };   // who made it: a row, or (later) you

type MomentRule = {
  id: string;                  // a built-in rule: "row:<key>:<n>", stable while the row's value is
  kind: "moment";
  source: Source;
  on: boolean;
  when: EventId;               // "album.open" | "artist.open" | "diary.open" | "cog" | "playlist.create" | "sleep.arm"
  card: CardId | "*";
  if?: Cond;
  do: Action;
};

type StateRule = {
  id: string;
  kind: "state";
  source: Source;
  on: boolean;
  while: Cond;
  set: { target: RuleTarget; value: unknown }[];     // a look sets theme AND skin
  onHand: "next" | "session" | "off" | "learn" | { until: Cond };
};

type RuleTarget = { key: RuleKey } | { prop: PropId };  // a store key (§7) or a property (§7b)

type Action =
  | { grow: "horizontal" | "vertical" | "full" }
  | { summon: CardId }
  | { sleep: { at: "clock" | "sun" } };

type Cond =
  | { all: Leaf[] | Group[] | (Leaf | Group)[] }
  | { any: (Leaf | Group)[] }
  | { not: Leaf | Group }
  | Leaf;
type Group = { all: Leaf[] } | { any: Leaf[] } | { not: Leaf };
type Leaf = { fact: FactId; is: Value | Value[] };   // a list = any of these values
```

**Depth.** A condition is a leaf, or a group of leaves, or a group whose members are leaves
and groups of leaves. That is one level of groups inside the top group, and no deeper.
`validate()` refuses a deeper rule, and the engine skips it as broken (§11).

**The Diary's row as rules.** *New entries* makes two rules:

```ts
{ kind: "moment", when: "diary.open", card: "diary", do: { grow: "vertical" },
  if: { all: [{ fact: "entry.new", is: true }, { fact: "surface", is: "max" }] } }
{ kind: "moment", when: "diary.open", card: "diary", do: { grow: "horizontal" },
  if: { all: [{ fact: "entry.new", is: true }, { fact: "surface", is: "midi" }] } }
```

*Every entry* drops the `entry.new` leaf. *Never* makes no rule.

## 5. Facts

A fact is a small function the engine calls when it checks a rule. The list is closed. Each
event names the facts it supplies. A fact never calls Apple: it reads what the app holds.

| Fact | Values | Read from | Used by |
|---|---|---|---|
| `surface` | mini · player · midi · max | surface.ts | grows, Keep on top |
| `cause` | hand · compass · agent | the event's context | (later) |
| `from` | the card a drill came from | the event's context | (later) |
| `entry.new` | true · false | diary-card.ts (`created` from `diary_open`) | the Diary |
| `daylight` | true · false | look-schedule.ts `plan()` | the look schedule |
| `lookMode` | off · sun · clock · windows | the store | the look schedule |
| `output` | an output key | sound.ts `getOutput()` | EQ for each output |
| `now` | epoch ms | the clock | the sharing pause |

A fact that changes over time without a seam (`daylight`, `now`) has a provider that tells the
engine the time of its next change. The engine sets one timer for the nearest one, and checks
again when the page becomes visible (a timer stops while the PC sleeps).

## 6. The registry

```ts
registerEvent("album.open", { facts: ["surface", "cause", "from"] });
registerFact("output", () => getOutput().key, { seam: onOutputChange });
registerAction("grow", { kind: "moment", run: (card, arg, ctx) => growByRule(card, arg, ctx) });
registerProp("window.onTop", { apply: (on) => appWindow.setAlwaysOnTop(on), off: false });
```

- A new module adds its parts here. The editor, later, reads the same lists.
- An action has a **cost label**: `free`, or `apple` for one that calls Apple. None of this
  branch's actions calls Apple.
- **Never a rule target:** the agent gates (`agentSettings`, `agentControl`, `agentDiary`,
  `agentHistory`), `updateMode`, the Apple-write switches, window sizes, Reset, Rust-owned keys.
  They are not `RuleKey`s, so no rule can name them.

## 7. The overlay

**The read today.** `setting(key)` in `settings-store.ts` returns `state[key]`: 304 call sites
in 52 files. `setSetting` stores the whole object and tells the listeners the key.

**The safe way (decided).**

```ts
export type RuleKey = "theme" | "skin" | "soundEqPreset" | "shareActivityApp" | "shareActivityDiscord" | "discordRoomInvite";

setting<K extends Exclude<keyof Settings, RuleKey>>(k: K)  // every other key, as today
effective<K extends RuleKey>(k: K)       // the value to act on: the rule's value, or yours
ownSetting<K extends RuleKey>(k: K)      // your value: the Settings card, the agent, a toggle
```

- **Drift is caught by the compiler.** A key added to `RuleKey` makes `npx tsc --noEmit` list
  every `setting()` read of it. Each one must choose `effective` or `ownSetting`. A module
  written later cannot read the key the wrong way.
- **The read-then-write bug cannot hide.** A toggle must say `ownSetting` to compile.
- **The overlay is kept in memory only.** `setOverlay(key, value | undefined, ruleId)` is
  exported for `rules.ts` alone (a name with a leading underscore and a comment; nothing else
  calls it).
- **Listeners hear a rule start and end.** `onSettingsChange` fires for a `RuleKey` when its
  effective value changes. A new `onOwnChange` fires when your value changes under an active
  rule (the chip listens).
- **The tray panel** does not run the engine. The only rule-set values it shows are the theme
  and skin, and it already takes them from `publishAppearance` (np-bus).

### 7a. Theme and skin move into the store (decided)

Today `theme.ts` and `skin.ts` keep `deets.theme` and `deets.skin`, and `applyLook` writes them.
Readers: the pre-paint in `index.html` and `tray.html`, the first-install check
(`seedOnboarding` in settings-store.ts), `scripts/shots.mjs`, `vite.demo.config.ts`.

- Two store keys, `theme` and `skin`, both `RuleKey`s. Defaults: `defaultTheme()` /
  `defaultSkin()` resolved at first load (the curated pair), as today.
- **Migration, one time:** at load, a store with no `theme` takes `deets.theme` (through the
  RETIRED maps), the same for `skin`.
- **The old keys stay written, as a mirror of your value.** Settings › Updates › Roll back can
  install an older build, which reads only the old keys. The mirror keeps your look after a
  roll back. Nothing new reads them.
- **The first-install check** reads "the store has `theme`, or `deets.theme` exists".
- **The pre-paints** (`index.html`, `tray.html`) read `deets.settings` first and fall back to
  the old keys. The look-schedule pre-paint (`deets.look.prepaint`, `deets.look.hold`) does not
  change.
- `shots.mjs` and `vite.demo.config.ts` write the store key.
- `applyTheme(name)` becomes `paintTheme(name)`: it sets `data-theme` and never writes storage.
  A hand pick is `setSetting("theme", …)`. One subscriber paints `effective("theme")` when it
  changes, inside the appearance transition. The same for the skin.
- **A build check** in `npm run check` fails when a file other than settings-store.ts, the two
  pre-paints, shots.mjs and vite.demo.config.ts names `deets.theme` or `deets.skin`.

### 7b. Properties

Keep on top is a window property, not a stored value. A state rule can target a **property**:
a registered apply function with an "off" value. A property has no "your value" and no hand
change, because only its Settings row controls it.

## 8. A hand change

You change a value that an active state rule set. **Your change wins.** The rule stands aside
for that target. Its `onHand` says when it acts again:

| `onHand` | The rule acts again | Kept where |
|---|---|---|
| `next` | When a fact the rule reads changes | Memory |
| `session` | When the app starts again. Minimize to tray does not end a session | Memory |
| `off` | When you press Resume (the chip) or turn the row on again | The row (built-in) or the rule |
| `{ until: Cond }` | When the condition becomes true | Memory |
| `learn` | Never stands aside: your change becomes the rule's new value (EQ for each output) | The row's data |

- Resume on the chip ends a hold at once.
- After a restart, `next` and `session` holds are gone; the rule applies at its first check.
- The look schedule's **Menu pick lasts** row maps to it: *Until next change* = `next`,
  *For good* = `off` (which turns the schedule row to Off, as today).

## 9. The chip

> **Part:** built · 2026-09-26 · **his design:** a dot, no disc. **Green** (`--rule-chip-rule`:
> Forest on a light theme, Fern on a dark one) = a rule set this value. **Scarlet**
> (`--rule-chip-hand`: Blood on light, Siren on dark) = your pick holds; a press gives it back
> to the rule. The bolt and the hand below were the placeholders; both read as blobs at 12 px.
> In a title-menu row the dot sits at the right, beside the chevron. The code keeps the kind
> names `bolt` and `hand`.

A place that shows a rule-set value carries a chip.

- **Bolt** (placeholder): a rule set this value. The hover hint names the rule and your value:
  "The look schedule shows Night. Your pick is Lilac."
- **Hand** (placeholder): you changed this, and the rule stands aside. The hint says when it acts
  again: "Your pick stays until sunrise, 6:42". Pressing the chip resumes the rule.
- **Where it shows in this branch:** the title menu's Theme and Skin flyouts, the Sound panel's
  preset (EQ for each output), the Sharing rows while paused.
- **Family:** a mark beside a label, the New badge's family (QUICK-SETTINGS.md §10). The icons
  are Tabler-style inline SVG, colored by theme roles, sized by skin tokens.
- **His design replaces the placeholders later.** The chip is one module, `rule-chip.ts`, so
  the change is in one place.

## 10. How the engine runs

**Events at the seams.** A site reports what happened with one call: `emit("album.open", ctx)`.
Only `rules.ts` knows rules exist.

| Event | Where it fires | Not fired by |
|---|---|---|
| `album.open`, `artist.open` | `drill()` in collection-card.ts when the new level's key starts `album:` / `artist:`; `pushPane()` in search-card.ts for an album or artist pane | a card-memory restore; `replace()` (the Lib \| Full chips); a drill that swaps into a grown place |
| `diary.open` | diary-card.ts where it grows today (`showEntry`) | reopening the same entry |
| `cog` | quick-panel.ts, in place of `expandCard` | the cog's second press (a collapse, as today) |
| `playlist.create` | playlists-card.ts, where it summons Search today | — |
| `sleep.arm` | at launch, after a sleep ends, on a Sleep row change, on wake | — |

- **Moment rules:** `emit` → `pickMoment(rules, event, card, facts)` → the first match → the
  action. Actions run with `emit` held, so no rule sets off a rule.
- **State rules:** on any seam that a state rule's facts name, and on a fact provider's timer,
  the engine runs `resolveState` and updates the overlay and the properties. **A seam that fires
  with no change is no check** (2026-09-27): `registerFact` keeps each fact's last value (JSON)
  and rechecks only when it moved. Sound's seam fires with the audio worklet's status, about 4
  times a second with the EQ on, and each check redrew the Rulez card.
- **`rules-eval.ts` is pure** (no DOM), and `npm test` covers it.

**The grow action.** `growByRule(card, axis, cause)` in card-grow.ts:
- does nothing when *Grow cards from edges* is off, in Mini or Player, or when any grow is on
  screen (fork 7A);
- waits for `whenSwapSettled()`;
- `vertical` = the up or down neighbour, `horizontal` = left or right, `full` = Fill (Max only);
  no neighbour on that axis = `no-axis`;
- marks the level: `{ card, depth }` for a collection card, `{ card, pane }` for a Search pane,
  `{ card: "diary", entry }` for the Diary.

**Back.** Each back path (collection `back()`, search `backPane()` / `popPane()`, the Diary's
Back) calls `levelLeft(card, depth)`. When the marked level is gone and the grow on screen is
still the rule grow, `collapseGrow("rule-back")`. A hand change in between (a Pin, a grow from
the button or an edge, a card pick) clears the mark through `onGrowChange`, and Back leaves it.

**Why no worker thread.** A watcher cannot see code paths, so every design needs a call at the
site. The check is microseconds. A worker has no DOM and no grow state, so each check would be
an async round trip, and the level would paint small and then jump.

## 11. Guards

1. **No rule sets off a rule.** `emit` is held while an action or an overlay change runs.
2. **A broken rule is skipped.** An unknown event, fact, action or target, or a condition too
   deep: skipped and logged, never a crash.
3. **Cost labels** on actions (§6).
4. **Playback first.** Each action and each `resolveState` runs in try/catch. A throw logs an
   ERROR line and the engine goes on.
5. **It explains itself.** `diag.log("rule", { id, event, applied, reason })` per fire, per state
   start and end, per hold, per rule that lost to an earlier one.

## 12. Storage — JSON, not XML

- One store key, `rules`: `Stored`, empty (`{ v: 1, rules: [] }`). Built-in rules are never
  stored: they are made from the rows at load and on each row change. The key is internal (no
  row, no agent spec) until the editor.
- **Not XML.** JSON holds the shape already. What protects the app from odd rules is the
  validator and the broken-rule state (§11).

## 13. The rows that make rules

| Row (key) | The rules it makes | Kind |
|---|---|---|
| Window › **Grow on album or artist** (`drillGrow`, new) | *Vertical*: `album.open` and `artist.open` → vertical if Max, horizontal if Midi. *Full*: full if Max, horizontal if Midi. *Off*: none | Moment |
| Diary › Grow on open (`diaryGrow`) | §4 | Moment |
| (no row) the cog | `cog` → full if Max, horizontal if Midi | Moment |
| Look schedule (`lookSchedule`, the day and night looks, `lookHold`) | While `daylight` → day theme + skin; while not → night theme + skin. `onHand` from `lookHold`. *Off*: none | State |
| Window › Keep on top (`alwaysOnTop`) | *Always*: `window.onTop` = true. *Player*: while `surface` = player. *Off*: none | State (property) |
| Sound › Remember each output (`soundEqPerOutput`, `soundEqOutputs`) | One rule per remembered output: while `output` = key → `soundEqPreset` = id. `onHand: learn` | State |
| Sharing › Pause sharing for an hour (`sharePauseUntil`) | While `now` < until → the three sharing keys = false | State |
| Playlists › New playlist opens Search (`playlistCreateSummon`) | `playlist.create` → summon Search; *Not in mini* adds `if surface ≠ mini` | Moment |
| Sleep › Sleep every day (`sleepSchedule`, `sleepAt`) | `sleep.arm` → sleep at the clock time or sunset. The wind down and play out stay in sleep.ts | Moment |
| Menus › **Go to opens** (`goToTarget`, new 2026-09-27, RULEZ.md §10.1) | *Search* / *Library*: `goto.artist` and `goto.album` → `openIn`. *Where it fits*: none (the Library in place, other cards in Search) | Moment |
| Playback › Idle shuffle plays (`shuffleIdle`, 2026-09-27) | *Library*: `shuffle.press` if `loaded` is false → `shuffleLibrary`. *Nothing*: none. player.ts has no idle branch of its own | Moment |

The rows keep their keys, values, defaults, agent specs, hints and Reset. Nothing migrates
except theme and skin (§7a).

## 14. What waits

- The rules editor, the agent's rules verb, the text form.
- Facts for later: `genre`, `room`, `from`, `cause`, `slot`, battery, a metered network.
- Rows not converted: Weekly Replay (an Apple action), Card on drill, Headphone crossfeed (hidden).

## 15. Open

- **R5 — The chip's look:** his design. The build uses the bolt and the hand.

## 16. Desk tests

Written per step in §17. Claude runs them on `npm run dev:app` and drives the UI (clicks
through `scripts/webview-eval.mjs`, not module imports), reads `diag` and the `rule` lines, and
takes a picture of each visible step. Steps that need his hardware or ear are marked **his**.

## 17. The build plan (branch `rules-rulez`)

**Ground rules for the branch.**
- Branch `rules-rulez` (the owner's name). It exists already: made from `main` at `7785a75`
  (0.14.8), and it tracks `origin/rules-rulez`. Build on it; do not make another. One commit per step, with the co-author line. No merge, no
  push, no release: he merges after his test.
- Every step ends with `npm run check` (tsc, tests, docs:check, cargo) and `npx vite build`,
  then its desk test. A step is not committed until both pass.
- **A step that fails its desk test after two fix attempts is reverted,** written in WORKLOG.md
  with what was seen, and the steps that depend on it are skipped. Independent steps go on.
- If music stops playing or the app hangs at any point: stop that step, revert it, and log.
- The CLAUDE.md checklist applies to each new row and the chip: motion, tokens, family, hints
  (ONBOARDING.md), `NEW_MARKS`, agent spec + AGENT.md line, log lines, Compass.
- A doc is updated in the same commit as its code: SETTINGS.md, SETTINGS-INVENTORY.md,
  CARD-GROW.md §18 (as built), DIARY.md §4a, LOOK-SCHEDULE.md, SOUND.md, the sleep section of
  NEXT-VERSION.md, and an "As built" section here.

### Step 1 — the pure core (`rules-eval.ts`, tests)
- The types of §4; `validate(rule, registry)` (the depth rule, known names);
  `evalCond(cond, facts)`; `pickMoment(rules, event, card, facts)`;
  `resolveState(rules, facts, holds) → Map<target, { value, ruleId }>`; the hold state machine
  (`handChange`, `factsChanged`, `resume`, `restart`); `builtinRules(settings) → Rule[]` for
  every row in §13.
- `tests/rules-eval.test.ts`: all / any / not and lists; the depth refusal; first match;
  a card rule over `*`; each row's rules for each of its values; every `onHand` path; `learn`.
- Desk test: none (no UI). Gate: `npm test`.

### Step 2 — the engine (`rules.ts`)
- The registry; `emit` with the hold (no rule sets off a rule); the state loop with seam
  subscriptions and the one fact timer; the `rules` store key (internal); `diag` lines;
  try/catch per action. `initRules()` in main.ts after the store and before the cards.
- Nothing is registered yet, so the app behaves as before.
- Desk test: the app starts; `diag` shows `rule:init` with 0 rules; play a song.

### Step 3 — grow rules
- card-grow.ts: `growByRule`, the level mark, `levelLeft`, the mark cleared on a hand change.
- Emits: collection-card.ts `drill()` (not `replace()`, not `restore()`), search-card.ts
  `pushPane()` (not a memory restore), diary-card.ts, quick-panel.ts. Back paths call
  `levelLeft`. `grewForEntry` and the `diaryGrow` read in diary-card.ts go; `expandCard` stays
  for the agent's `grow` and is no longer the cog's path.
- The new row `drillGrow` (Settings › Window, under the grow rows): label **Grow on album or
  artist**, pills *Vertical* / *Full* / *Off*, default *Vertical*, hint "An album or artist
  opens with more room: taller in Max, wider in Midi. Back returns it". `NEW_MARKS` line, agent
  spec, AGENT.md, ONBOARDING.md, SETTINGS.md, SETTINGS-INVENTORY.md.
- Desk test (Max): (1) Library, open an album → the card grows over the card below; Back →
  it returns. (2) Two levels: album → artist; Back once → still grown; Back again → returns.
  (3) Lib | Full on the album → no change to the grow. (4) Pin during a rule grow, then Back →
  stays grown. (5) Search, an album pane → grows; Back → returns. (6) Row = *Full* → the album
  fills; *Off* → nothing. (7) Midi → the album widens. (8) Mini → nothing. (9) Diary: a new
  entry grows, a reopened one does not; *Every entry* grows both. (10) The cog fills Settings;
  a second press collapses. (11) A card already grown by hand, then open an album → no change.
  (12) *Grow cards from edges* off → nothing grows.

### Step 4 — the overlay
- settings-store.ts: `RuleKey` (empty at first), `effective`, `ownSetting`, `setOverlay`,
  `onOwnChange`, and `setting()` narrowed to non-`RuleKey` keys.
- The chip module (`rule-chip.ts`) with the bolt and the hand, not attached yet.
- Desk test: none visible; gate `npm run check`.

### Step 5 — theme and skin into the store (§7a)
- The keys, the migration, the mirror, the first-install check, both pre-paints, shots.mjs,
  vite.demo.config.ts, `paintTheme` / `paintSkin`, the one subscriber, the build check. Callers
  move: main.ts (the title menu), settings-card.ts (Reset), agent-settings.ts, look-schedule.ts.
- Desk test: (1) a restart keeps the look, with no flash of another look. (2) A title-menu pick
  holds after a restart. (3) Reset › Theme and skin → the curated pair. (4) The tray panel
  follows a change. (5) `npm run dev:fresh` → a first run still starts the walk. (6) An agent
  `settings` theme change works. (7) The web demo build (`vite.demo.config.ts`) still paints.

### Step 6 — the look schedule as state rules
- look-schedule.ts keeps the sun and clock plan, the pre-paint writes and `scheduleStatus()`.
  It becomes the provider of `daylight` and `lookMode`. `applyLook` and the hold key logic
  become the two built-in rules and the engine's hold (`lookHold` → `onHand`). The chip on the
  title menu's Theme and Skin flyouts.
- Desk test: (1) *Set times* with the day window around now → the day look; move the window →
  the night look, animated. (2) A title-menu pick → it holds; the flyout shows the hand chip
  and its hint. (3) Move the window again (the period changes) → the rule applies again. (4)
  *For good* → a pick turns the schedule row to Off. (5) Restart during a period → no flash.
  (6) *Windows* mode follows the OS mode. (7) The chip resumes the rule on a press.

### Step 7 — Keep on top as a property
- `registerProp("window.onTop")`; main.ts's `applyAlwaysOnTop` goes; the row makes its rule.
- Desk test: *Player* → on top only in the player view (read with the window's
  `isAlwaysOnTop()`); *Always*; *Off*.

### Step 8 — the sharing pause
- The three sharing keys become `RuleKey`s (tsc lists their readers). presence.ts reads
  `effective`; `paused()` goes. The row makes the `now` rule. The chip on the Sharing rows.
- Desk test: press Pause → the rows show the bolt and the time; Discord presence clears (read
  the `presence` diag lines); set the until to a minute ahead (DevTools) → sharing returns by
  itself. **His:** a look at his Discord profile.

### Step 9 — EQ for each output
- `soundEqPreset` becomes a `RuleKey`; `output` becomes a fact with its seam (`setOutput`);
  `selectPreset` on an output with a rule writes the row's data (`learn`); `setOutput`'s own
  write goes. The chip in the Sound panel.
- Desk test: the dev app's output list — pick a preset on "This PC"; switch to an AirPlay
  output if one answers, else **his**: plug headphones, pick a preset, unplug → back to the
  speakers' preset; plug in → the headphones' preset, with the chip.

### Step 10 — the summon action
- `summon` action; the `playlist.create` emit; the row makes its rule.
- Desk test: New playlist in Midi → Search comes beside it; in Mini → it does not (*Not in
  mini*); *Always* → it does; *Off* → never.

### Step 11 — the sleep action
- `sleep` action: it asks sleep.ts to arm its clock for the next mark (clock time or sunset).
  sleep.ts keeps the dial, the warning, the wind down and the play out. The `sleep.arm` emits.
  The daily arm logic in sleep.ts goes.
- Desk test: set *Sleep every day* to a clock time two minutes ahead, play a song → the warning,
  the wind down, the pause; the next day's mark is armed (`sleepStatus()`); *Off* → nothing is
  armed; a sleep panel set by hand still works.

### Step 12 — the docs and the hand-off
- The "As built" section here; RULES.md front matter to `built`, `desk_test: open`;
  HANDOFF.md and WORKLOG.md; CLAUDE.md's line; `npm run docs:check`.
- The hand-off lists: what passed, what is **his**, what I decided inside his choices.

## 18. As built (branch `rules-rulez`, 2026-09-26)

> **Part:** built · 2026-09-26

Where this section and §1–§17 differ, this section is the code.

**His calls during the build (2026-09-26).**
- **Rules sit under the features; they never replace one.** The sleep timer stays the same
  feature (dial, chips, warning, wind-down, play-out); its *Sleep every day* row is now a rule.
  The same for the look schedule, Keep on top, EQ for each output and the sharing pause.
- **A `next` hold survives a restart** (§8 said memory). The engine saves `next` holds to
  `deets.rules.holds` with the facts the rule read; at launch a hold whose facts moved ends at
  the first check. So a hand-picked look still holds until the next day / night change, as
  `deets.look.hold` did, and the pre-paint keeps reading `deets.look.hold`.
- **A leaf can compare numbers:** `{ fact, is?, lt?, gte? }`; every test given must hold. The
  sharing pause is `{ fact: "now", lt: until }`.

**Files.** `src/rules-eval.ts` (pure, `tests/rules-eval.test.ts`) · `src/rules.ts` (registry,
`emit`, the state check, holds, the chip's view, `__rules` in DevTools under the telemetry flag)
· `src/rule-chip.ts` · `src/settings-store.ts` (`RULE_KEYS`, `effective`, `ownSetting`,
`overlayOf`, `_setOverlay`, `onOwnChange`, `allSettings`, the `rules` key).

**Decided inside his choices (for his review).**
- The rule list is the user's rules first, then the built-in ones. A user rule wins a tie.
- A built-in rule whose event, fact or action is not registered yet waits with no log line (the
  modules register at their own init). Only a user rule logs `rule:skip`.
- A fact is known when a provider reads it or an event names it (`entry.new` comes only with
  `diary.open`).
- A `Source` can also be `{ fixed: "cog" }`: the cog's rule has no row.
- A hand change on one target of a state rule holds every target the rule sets (a look is its
  theme and its skin together).
- `emit` and the state check hold each other off: an action's own emits, and an emit from a
  listener during a check, are refused and logged `reason: "held"`.
- The `surface` fact is registered in main.ts, not surface.ts: the unit tests load surface.ts,
  and the engine's log keeps Node running.
- The cog keeps what it did: when another card is grown, the cog's rule ends that grow and
  opens Settings (the one exception to fork 7A, `growByRule(…, replace)`).
- `expandCard` and `growCardTaller` are removed; nothing called them any more.
- `host.dataset.mounted` (layout.ts) names the card a host shows; the emits read it, so the
  second Search card reports its own id.
- `webview-eval.mjs --shot FILE` saves a picture of the dev window (the desk tests' pictures).
- **Theme and skin (step 5).** `look-ids.ts` holds the RETIRED maps and the first-launch pair
  (pure, so the store migrates at load with no import cycle). `theme.ts` / `skin.ts` only paint
  (`paintTheme`, `paintSkin`). `look.ts` is the one painter: `initLook()` at launch, and
  `pickLook(look, opts)` for every hand pick (the title menu, the Compass through it, Reset, an
  agent with `by: "agent"`). It paints the effective pair on the next microtask, so a theme and
  a skin that change together animate once.
- `ownSetting` takes any key (not only a `RuleKey`): generic code — a Settings row, an agent
  spec, a Reset snapshot, the Sound panel's cycle pill — reads every key as yours.
- The resolved default look is not written to the store until some setting is saved; the
  mirror (`deets.theme`) is written at every load, which is what the first-install check and a
  roll back need.
- **Turning the schedule off still keeps the look on screen** (LOOK-SCHEDULE.md): the schedule
  no longer writes your pick, so `keepShownLook()` writes the look on screen as your pick when
  the row goes Off. Without it, Off would have shown your older pick: a change you could see.
- **The look schedule (step 6)** is LOOK-SCHEDULE.md §5. Inside it: `pickLook` writes both
  halves (the one you did not pick as it shows), so a theme pick under the schedule keeps the
  scheduled skin, as before; `noteHandPick()` now only marks "a hand pick is being written",
  so *For good* keeps your pick and not the scheduled look; `initLookSchedule()` runs before
  `initLook()`, so the first paint has the scheduled look.
- **Picking your own value while a rule shows another** (you own Lilac, the schedule shows
  Black & Red, you pick Lilac) is still a hand change: `setSetting` tells `onOwnChange` even
  though your value does not move.
- **A saved hold at launch.** A fact that no module has registered yet is not a change
  (`factsChanged`), and a hold is checked against every rule, not only the live ones; at
  launch a saved hold stays while its rule exists (there is no "before" list to compare).
  Found at the desk: without these, a held pick was lost on reload. **A second cause, found
  later the same night:** step 8 registered the `now` fact inside `initRules()` before the
  first build, and that registration's check ended every saved hold. The first build now comes
  first, and a check before it does nothing (`built`).
- **Keep on top (step 7):** `registerProp("window.onTop")` in main.ts; `applyAlwaysOnTop` is
  gone. The engine applies the property's "off" value (false) at its first check.
- **The sharing pause (step 8):** the three switches are rule keys; `presence.ts` and
  `friends.ts` read `effective`, and their own `paused()` is gone. The row still writes
  `sharePauseUntil`, and the old 30 s timers that clear it stay (they only tidy the row's data;
  the rule ends at its time through the engine's timer). `now` is the engine's own fact.
- **The chip in the Settings card:** every row whose key is a rule key gets a slot in its label,
  and a chip fills it after each render. The Settings card also repaints on `onOwnChange`, so a
  row shows your value when you change it under a rule.
- **No bolt when the rule lays your own value** (a sharing switch that is Off already, under
  the pause): the chip hides, because nothing you can see changed.
- The build check is a unit test, `tests/look-keys.test.ts`; the migration and the
  first-install rule are `tests/look-migrate.test.ts` (in place of wiping the dev profile with
  `dev:fresh`).

**Steps and desk tests** (Claude, on `npm run dev:app`, driven through the UI with a picture
of each visible step; setup such as a time two minutes ahead went through the store).

| Step | Commit | Desk test | His |
|---|---|---|---|
| 1 the pure core | `7c65002` | `npm test`: 24 tests in `rules-eval.test.ts`, 7 more in the two `look-*` tests | — |
| 2 + 4 the engine, the overlay, the chip | `bddf7a4` | `rule:init` with 12 rules, nothing changes | — |
| 3 grow rules, *Grow on album or artist* | `b029fb2` | 1–8, 10–12 pass; 9 for a reopened entry (a new entry is the unit test's) | a new Diary entry grows |
| 5 theme and skin in the store | `5c93d85` | 1, 2, 3, 6, 7 pass; 5 as unit tests | 4 the tray panel follows; 5 a real `dev:fresh` |
| 6 the look schedule | `ed641ff` | 1–5, 7 pass; Off keeps the look | 6 Windows mode |
| 7 Keep on top | `010c153` | Player / Always / Off, read from the window | — |
| 8 the sharing pause | `4c752b1` | pause, its end by itself, a toggle ends it | his Discord profile |
| 9 EQ for each output | `7c3a628` | passes with a stood-in second output | real headphones |
| 10 the summon action | `e5aca30` | Midi summons, Mini does not | — |
| 11 Sleep every day | `a6bca97` | the warning, the pause, the next mark; Off; a hand timer | — |

**Performance, `main` against `rules-rulez` (2026-09-26, `npm run dev:built`, 244 Hz display;
League of Legends held 33–45 % of the GPU, so both ran `--contended` under the same load).**

| Measure | `main` | `rules-rulez` |
|---|---|---|
| Theme and skin switch, median fps (Press / Ocean / Glass / Cyber) | 237 / 235 / 231 / 237 | 238 / 235 / 232 / 235 |
| Grow scene, median fps | 239 / 230 / 238 / 239 | 239 / 229 / 238 / 239 |
| Launch, boot window (3 cold starts) | 1264 / 1259 / 1255 ms | 1257 / 1257 / 1258 ms |
| Click → sound, our part (init · pause · setQueue) | 3–4 · 10–13 · 4–44 ms | 3 · 9–12 · 4–35 ms |
| Album open, 1.2 s window (5 runs) | 0.3 % dropped, worst 8 ms | 0.7–1.8 % dropped, worst 21–29 ms |
| Album open with *Grow on album or artist* Off | — | 0.3 % dropped, worst 8 ms |
| One full state check (`__rules.recheck()`, 1,000 runs) | — | 0.23 ms |

The engine costs nothing measurable. The one new cost is the grow motion itself: with the row
at its default (*Vertical*) an album open runs the grow's clip and row entry at the same time
as the drill's slide, and drops a few frames (worst 21–29 ms against 8). With the row Off the
drill is `main`'s exactly. MusicKit's stream time varies with the network, not the branch.

**His call (2026-09-26): the grow waits for the slide.** `album.open` / `artist.open` are now
emitted when the drill's slide ends (collection-card.ts: the slide's `onDone`; search-card.ts:
the pane's `transitionend`, 500 ms fallback), and only if that level is still open. Measured
after (same machine, same load): album open 1.1–2.5 % dropped, **worst 13–17 ms** (was 21–29).
What drops is the Library grow's own cost: a hand grow of the same card, no drill, drops 0.7–3 %
with a worst frame of 21–29 ms, and its collapse 25–38 ms, on `main` too. Search's album pane:
0.9 %, worst 17 ms. Album → artist → Back → Back still grows once and returns at the root.

**His call, later the same day (2026-09-26): the grow replaces the slide.** The slide, then the
grow, read as two separate steps: the album showed in the small card first. Now the event is
emitted at the drill, BEFORE any slide. `growByRule` runs its checks at once (before it waits for
a swap or a grow in motion). When they pass, it blanks the card body (`.is-grow-rebuild`) and
sets `ruleGrowComing(card)`. The drill reads that and puts the new level in place with no slide
(collection-card.ts `place`; search-card.ts the restore's no-transition path). The grow's clip
and its row entry are then the one motion, so nothing runs over anything else. A grow that is
refused after the wait gives the body back and enters its rows. Only `album.open` /
`artist.open` do this; the cog, the Diary and a new playlist keep their motion. No grow coming
(the row Off, Mini, a grow already on screen) → the plain slide, as before. The `grow:rule` log
line carries `placed: true` for a grow that took this path.

The same day's fix: a **related** Search pane (Go to Album / Go to Artist from a song — every
Home song tile and library-album tile, by the id hop) sent no event at all, so Home's Go to
Album never grew. It sends `album.open` / `artist.open` now. So does a Library **Full** album or
artist, whose key is empty until its id loads (the level's `opens` field).

*Desk test.* Max, *Grow on album or artist* = Full. (1) Home › a song tile › Go to Album: the
Search card comes in, grows at once with its body blank, and the album's rows enter at full size.
No small album first. (2) The same from a library-album tile and a "New" tile. (3) Library ›
an album: no slide, one grow. (4) Row Off: the plain slide, no grow. (5) Back from the grown
album collapses it. (6) The cog still opens Settings as before. `deetsmusic diag --flush --tag
grow` shows `grow:rule … placed: true`.

**Changes a user can see** (each one is a consequence of a decided fork; listed so none ships
unseen):
- *Grow on album or artist* is new and **on by default** (*Vertical*): an album or artist that
  opens in a card now grows it (his default, §13). Since 2026-09-26 the grow replaces the slide:
  the level is put in place and the grow is the one motion (his call on the timing, above).
- A Pin (or any hand change to a grow) now keeps a Diary entry's grow when you go Back (it used
  to collapse). The same rule as every rule grow (fork 6A / 7A).
- EQ for each output: an output with nothing remembered shows your last pick, where it used to
  keep the previous output's preset.
- The rule chip: a dot beside the title menu's Theme and Skin, the Sound panel's preset, and
  the sharing switches while a rule acts on them — green when a rule set the value, red when
  your pick holds (§9). The New badge became a yellow dot of the same kind.

### 18a. Eight more rule keys, Battery saver, Focus (2026-09-27)

> **Part:** built · 2026-09-27 · desk test open (below)

**His calls (2026-09-27; my recommendation on all five forks).** The rule keys went first,
before any new events. The test: a key is a rule key when a fact we already have can decide
*while* it holds another value.

- **The eight keys:** `backgroundMotion`, `appearanceMotion`, `cardSwapMotion`,
  `fancyScrubber`, `glassFancy`, `friendsListenAlong`, `friendsRoomInvite`, `toasts`.
- **Added 2026-09-28 (his call):** `webPlayNew`, `webPlayMode`, `webSkipSeed`, `webSkipSeedAt`
  (PLAYLIST-WEB.md §11). `webPlayMode` and `webSkipSeedAt` have no Settings row: a While row in
  Rulez is how a pro user sets them. `webSkipSeedAt` is the first number rule key, so the range
  row reads it with `ownSetting`.
- **Dropped at the check: the network keys** (`streamQuality`, `homeApple`,
  `playlistAutoRefresh`). The only fact for them, `dataSaver`, reads
  `navigator.connection.saveData`, which Windows never sets, not on a metered connection either.
  *Auto* stream quality already follows the network speed (`player.ts applyStreamQuality`).
  A `metered` fact read from Windows in Rust would open them; not built.
- **Recipe Battery saver** (`battery`): *While charging is false* → Fancy Glass off, Animate
  backgrounds Reduced, Animate card swaps off, Animate look changes off; `onHand: "next"`. The
  Fancy scrubber stays yours. A desktop reports charging, and a WebView with no battery API has
  no fact, so the rule never holds on either.
- **Focus** adds the two Friends switches to its sharing rule (`recipe:focus:0`) and a new rule
  `recipe:focus:2`, *Show notices: Failures*. `SHARING_KEYS` does not change: it is also what
  *Pause sharing for an hour* stops (FRIENDS.md D11), and that row covers the Sharing section only.
- **The Glass sliders** in Settings follow your Fancy Glass (`ownSetting`), so you can tune them
  while Battery saver holds it off; the row's dot shows the rule.
- **The Rulez words** are the Settings rows' own labels and choices, While rows only (the shape
  of *Collapse on outside click*): `keyWord()` in rulez-words.ts; the Logs view's names in
  rulez-logs.ts.

**The readers.** Each act-now read became `effective`: ambient.ts, appearance.ts,
boot-cover.ts, card-swap.ts, handoff.ts, skin-settings.ts, wallpaper.ts, toast.ts, friends.ts.
The listeners in ambient.ts, skin-settings.ts and wallpaper.ts already filter on the key, and
the overlay fires them when a rule starts or ends.

**Found on the way.** A change to *Put my room code on my box* did not send your box again, so
a code switched off stayed on friends' rows until the next song. friends.ts now pushes at once
when the switch's effective value changes while you host (by hand or by Focus).

**Tests.** `tests/rule-keys.test.ts`: Battery saver holds on `charging: false` only; Focus sets
the five sharing switches and *Failures*; the words read back as the rows'.

**Desk test.**
1. Rulez › Battery saver on. In DevTools, the charging fact cannot be set by hand, so on a
   desktop the recipe reads *Would not run now*. Make a copy (Duplicate) and change its While to
   *Always*: Glass with Fancy Glass on goes plain, the backgrounds slow, a card swap snaps, a
   theme change has no animation. The Motion rows and Fancy Glass wear the green dot. Turn the copy off:
   all four come back.
2. With the copy on, set Animate card swaps on by hand: the dot turns red, swaps animate;
   the hold ends at the next change of the fact (`next`).
3. **His, on a laptop:** Battery saver on, unplug, then plug in again.
4. Focus on: the two Friends rows and Show notices wear the green dot; an Add to Library shows
   no confirmation; a failure still shows. Hosting a room with the invite on: a friend's row
   loses the code at once when Focus turns on.

**Run (2026-09-27 evening, Claude, dev app, through the UI).** Steps 1, 2 and 4 pass; 3 is his.
- 1: the recipe on reads *Would not run now: "The PC is on battery" is not true*. The copy on
  *Always*: `data-glass-fancy` off, `data-bg-motion` reduced, a card swap wrote no `frames swap`
  line (the same swap with the copy off wrote one), a Live Theming change wrote no
  `theme-fade` line. The three Motion rows wear the green dot; the Fancy scrubber none.
- 2: the red dot's press gave all four back to the rule at once.
- 4: Show notices: `__toast.demo()` showed the warning and the error only. Two dev apps, a room
  hosted on a local rooms worker: the invite switch off by hand pushed at once
  (`friends:push why=roomInvite`) and the friend's box lost *In a room* within a second, with no
  song change; Focus on hid the box. A switch whose value already equals the rule's shows no
  dot (`chipState`, by design).

**Found at the run, his forks:**
- **One hand change sets the whole rule aside.** `onHand` holds every target the rule sets
  (rules.ts, "a look is its theme AND its skin"), so turning Animate card swaps on by hand
  brings Fancy Glass and the backgrounds back too, until the charger changes. §8 says "for
  that target". Keep it whole, or hold per target for a rule that is not a look.
  **His call (2026-09-27 late night): keep it whole** — "feels more intuitive if the rule sticks
  together". No change to the code; §8's "for that target" is read as "for that rule".
- **A switch row shows your value, not the rule's.** Under Battery saver, *Animate card swaps*
  reads On while swaps are off; the first press turns your value Off (no visible change), the
  second On. Only the dot says a rule acts.
  **His call (2026-09-27 late night): show the value in force**, with the dot. One press is a
  hand change to the other value, which (by the call above) sets the whole rule aside.
  **Built the same night:** `inForce` in settings-card.ts — every Settings row for a rule key
  (switches, pills, menus, and the same rows in the quick panel and the Compass) reads
  `effective`. The agent's `settings get`, the Reset snapshot and the Glass sliders' gate still
  read your value. A press for the value you already have (own On, held Off, press → On) still
  reaches the rule: `setSetting` fires the hand change when a rule shows another value.
  *Desk test (Claude, dev app, Battery saver, a faked unplug):* unplugged, Animate card swaps
  and Animate look changes read Off and Animate backgrounds Reduced, your values On; one press
  on Animate card swaps → it reads On, the rule's four keys are held (`holds`), all four rows
  back; plugged in → the holds end. His look: the rows under a rule, and the dot beside them.
- **The condition block cuts a yes / no fact's words** (rulez-card.ts, `blockHTML`): it slices
  the fact's label length off the phrase, so *Charging* + *The PC is on battery* reads
  "Charging" + "s on battery". Every yes / no fact whose phrase does not start with its label
  (loaded, playing, explicit, loved, online, charging…). Was there before this build.
  **Fixed 2026-09-27 late night:** `leafParts` hands the card the parts, and a yes / no phrase
  is one blank (RULEZ.md §6.5, the grammar rules).
- A recipe's dot says "A rule sets this now."; a rule of yours names itself.

## 19. Adding a feature that uses rules

> **Part:** guide · 2026-09-26

**When.** A feature that decides *when* or *while* something happens — at a time, in a surface,
on an output, for a genre, after an action — puts that decision in a rule. The feature keeps
its own module, UI and behavior; the rule only says when (his rule, 2026-09-26: rules sit
under features, never replace one). A feature with no "when" does not need the engine.

**How it runs.** No worker, no thread. `emit()` is a plain call on the page's main thread: it
reads the facts, picks the first matching moment rule and runs its action, in microseconds. A
state check (all state rules, the overlay, the properties) measured 0.23 ms and runs only on a
seam, a row change, the one fact timer or the page showing again, never per frame (§10, §18).

**The steps** (names are in `src/rules-eval.ts` and `src/rules.ts`):

1. **Name the parts.** A new event goes in `EventId`, a new fact in `FactId`, a new action in
   the `Action` union (rules-eval.ts). The validator only runs rules whose names the registry
   knows, so a typo is a skipped rule, not a crash.
2. **Register them in the owner's init** — the module that knows the thing:
   - `registerEvent("x.happen", { facts: [...] })` — list the facts only the event supplies
     (like `entry.new`); they count as known.
   - `registerFact("x", () => value, { seam })` — `seam(cb)` calls `cb` when the value changes
     (sound.ts `onOutputChange`); a fact that changes with time and no seam gives `next` (the
     time of its next change) instead.
   - `registerAction("verb", { cost, run })` — `cost: "apple"` when it calls Apple (ask him
     the cost first, CLAUDE.md). `run(arg, ctx, rule)` may be async.
   - `registerProp("id", { apply, off })` for a window-like property no store key holds.
   A module that the unit tests load (settings-store.ts, surface.ts …) must NOT import rules.ts:
   its log timer keeps Node running. Register from main.ts or the owner's init instead (§18).
   A registration that must be in place before the first paint (the look) runs before `initLook`.
3. **Emit at the seam, after the motion.** `emit("x.happen", { card, facts, depth })` where the
   thing happened, once its own animation has ended (the drill emits in the slide's `onDone`,
   his call 2026-09-26). Not from a restore or a replay of state. `emit` returns the rule id
   that ran, or null.
4. **A value a rule may set is a rule key.** Add it to `RULE_KEYS` (settings-store.ts) and run
   `npx tsc --noEmit`: it lists every `setting()` read of that key. Each reader chooses:
   `effective(k)` for what acts now (the painter, the player, what is sent out), `ownSetting(k)`
   for your value (a Settings row, an agent spec, a toggle that reads and writes). Never a rule
   key: the agent gates, `updateMode`, the Apple-write switches, window sizes, Reset (§6).
5. **The row makes its rule.** Add its fields to `RowValues`, its rules to `builtinRules()`
   (ids `row:<key>:…`), its key to `ROW_KEYS` in rules.ts (so a change rebuilds), and to
   `ROW_OFF` if a hand change turns the row off (`onHand: "off"`). Pick `onHand` per §8:
   `next`, `session`, `off`, `learn` or `until`.
6. **Test the rule.** `tests/rules-eval.test.ts`: each of the row's values → the rule it makes
   and what it does; the new names go in the test's `known` sets, and the "every built-in rule is
   valid" test covers the shape. A bug gets a test with its date in the name.
7. **Show it.** A Settings row whose key is a rule key gets the chip by itself. Elsewhere, put
   `ruleChip("key:x").el` beside the value. Give the row's words: `registerChipText(row, { name,
   bolt, hand })` — the green dot's hint names the rule and your value; the red dot's hint says
   when the rule acts again.
8. **Check and log.** The engine logs every fire, start, end, hold and skip (`rule`, `rule:*`);
   the action logs its own outcome (`grow:rule`, `sleep:daily`). Desk-test it through the UI
   and read `__rules.applied()`, `__rules.holds()` and `__rules.facts()` in DevTools. Then the
   CLAUDE.md build checklist as for any row.

**Example — genre EQ (not built; an idea for Recipes).** Fact `genre` from the playing song
(registered in the player's init, seam = the song change; no Apple call if the track carries
its genre). Rules: while `genre` = X → `soundEqPreset` = Y, `onHand: "learn"`, made by a row
the way *Remember each output* makes its rules (§13). `soundEqPreset` is already a rule key, so
no reader changes; the Sound panel's chip already shows it. The first matching rule wins, so the
order of genre rules and output rules is the design fork to bring him. (A user can make this
rule in Rulez.)

## 20. Rulez — the rules builder card

> **Part:** built · 2026-09-27

Rulez, the card where a user makes rules, is its own doc: [RULEZ.md](../features/RULEZ.md)
(his forks §1, as built §2, the next routes §3, your own files §5, the sentence row §6). Moved
out of this doc on 2026-09-27: the engine
is architecture, the card is a feature. What the card added to the engine (the wider event and
fact set, any-depth conditions, `isNot` and the number tests, drafts, the clock, the cascade
guards, cancel events with `cancelled()` and `keep`) is code in `rules-eval.ts` and `rules.ts`
and described in RULEZ.md §1.5, §1.7 and §2.

