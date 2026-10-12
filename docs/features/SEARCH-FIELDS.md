---
status: built
desk_test: passed 2026-10-12
sources: [src/search-field.ts, src/library-albums.ts, src/search-card.ts, src/radio.ts, src/collection-card.ts, src/settings-card.ts, src/diary-card.ts, src/web.ts, src/compass.ts, src/find-key.ts, src/list-keys.ts, src/split-pill.ts, src/styles.css]
updated: 2026-10-12
---
# DeetsMusic — Search fields

> **Status (2026-10-12): §3–§5 BUILT, desk test passed (§9, run by Claude on the dev app).** The owner decided every fork in
> §3, §5 and §6 on 2026-09-24, and said go on 2026-10-12 (the full build, one commit). §8 is
> the as-built record; where it differs from §3–§5, §8 is the code. The Full | Lib pill (§6) is
> the next step (§7); it waits for his go.

**Terms.** A **search field** is a text box that filters or searches as you type. The
**shared function** is `searchField()` in a new module, `src/search-field.ts`. The **×** is
the clear button inside the field, at its right end.

---

## 1. The six search fields (measured 2026-09-24)

| Field | Code | Library | Apple Music |
|---|---|---|---|
| Search card | `search-card.ts` | no | yes, after each pause in typing |
| Library filter (every collection card) | `collection-card.ts` | the open list | no |
| Settings search | `settings-card.ts` | n/a (settings rows) | n/a |
| Diary album picker | `diary-card.ts` | yes, first | yes, automatically after each pause |
| Playlist Web seed field | `web.ts` | yes, first | only from the "Search Apple Music" row |
| Compass (Ctrl+Space) | `compass.ts` | yes, with places, settings and verbs | no; it sends the term to the Search card |

**What each field searches does not change.** Only the behavior becomes standard.

## 2. The behavior today

| | Search | Library | Settings | Diary | Web | Compass |
|---|---|---|---|---|---|---|
| Delay | 300 ms | none | none | 300 ms (own constant) | none | none |
| Escape | nothing | hides the bar, keeps the filter | clears + closes | closes the picker | nothing | clears, then closes on a 2nd press |
| × | clears | none | none | closes the picker | none | none |
| Ctrl+F | no | yes | yes | no | no | n/a |
| Arrows / Enter | no | no | no | no | yes | yes |

## 3. The standard (decided 2026-09-24)

Every field calls `searchField(input, opts)` once. The function owns these parts:

1. **×.** The function adds it inside the field. A click clears the text and keeps the focus
   in the field. The × is hidden when the field is empty. The native `type="search"` cancel
   button stays hidden. The Diary picker's × no longer closes the picker.
2. **Escape.** One press clears the text and closes the field. The function stops the key,
   so a panel or card behind the field does not also react.
   - For a field that is always visible (the Search card, the Web seed field), "close" means
     the focus leaves the field. The Search card then shows Recents, as it does for an
     empty field.
   - The Library filter's Escape now also removes the filter.
   - The Compass closes on the first Escape.
3. **Leaving the Diary picker.** Escape, or a **Back** button outside the field.
4. **Ctrl+F.** The function registers the field with `find-key.ts`. That file already sends
   Ctrl+F to the card you last pressed in. New: the Search card, the Diary picker and the
   Web field. The Compass keeps Ctrl+Space.
5. **Delay.** One constant, `SEARCH_DELAY_MS = 300`, in `search-field.ts`. Only the fields
   that call Apple as you type use it: the Search card and the Diary picker. The local
   filters (Library, Settings, Web, Compass) stay instant. The copies in `search-card.ts`
   (`DEBOUNCE_MS`) and `diary-card.ts` (`PICK_DEBOUNCE_MS`) go away. The value goes in
   FUTURE-SETTINGS.md as a behavior that could be exposed later.
6. **Arrows and Enter** work in the results of every field (the key model is in §5).
7. **The term.** The field's callback gets the trimmed text. The field still decides what to
   search and how to draw it.

## 4. The shape of the function (proposed)

```ts
searchField(input: HTMLInputElement, {
  onTerm: (term: string) => void,      // after the delay, or at once
  delay?: "apple" | "none",            // "apple" = SEARCH_DELAY_MS
  onClose?: () => void,                // Escape, after the clear
  finder?: HTMLElement,                // the card root for Ctrl+F
  results?: ListKeysOptions & { container: HTMLElement },  // §3.6
}): () => void                         // destroy
```

## 5. The key model for §3.6 (decided 2026-09-24)

Two models exist in the code. Each field uses the one that fits its results:

- **A. The caret stays in the field.** The arrows mark a row, Enter runs it, and you can keep
  typing. For results that drop down under the field: the Compass, the Web field, the Diary
  picker.
- **B. The focus moves into the list.** Down in the field moves the focus to the first row.
  Then `list-keys.ts` handles the arrows, Enter, the Menu key and Escape. For a card's own
  list: the Search card, the Library, Settings. B reuses `list-keys.ts`, so there is no
  second copy of the list keys.

## 6. The Search card's Full | Lib pill (decided 2026-09-24)

**The control.** A split pill at the top right of the Search card header, where SOTD sits in
Rewind: **Full | Lib**. Its family is the header action (`.panel__action--text`: fill,
border, height, radius, type). It is cut in two with the room guest pill's split
(`.room__pill`: two equal halves, a 1 px divider, the pressed half on `--picked`). The
alias tokens point at the header action's tokens. No new raw values.
**Built as a shared primitive (2026-09-24):** use `src/split-pill.ts` (`splitPillHTML`,
`splitPick`; CSS `.split-pill`, tokens `--split-pill-*`). Do not build a second pill. The
Library card's album and artist levels already use it (FULL-LIB.md).

**What each half searches.**

| | Full (default) | Lib |
|---|---|---|
| Songs, albums, artists, playlists | Apple catalog, as today | your library |
| Stations | Apple catalog | the stations you played (`radioRecents()`, the last 6; the same list the Compass uses) |
| Delay | `SEARCH_DELAY_MS` (Apple calls) | none (local, 0 calls) |

Both halves draw the results the same way: the same sections, rows, drills, menus and
category filter. Full does not add a library section, because Apple's results already hold
the songs in your library.

**Remembered?** The card opens on Full. A new Settings section, **Search**, holds one row:
**"Open search on"**, pills **Full | Last used**, default Full. It is a store key, so it
gets a default with its reason, an `agent-settings.ts` spec, a line in AGENT.md and a
`NEW_MARKS` line. The Compass reaches it automatically.

**The Compass.** A term sent from the Compass always runs in Full. The Compass already
lists your library items; you go to the Search card to reach Apple.

**Pins.** A pin saves the mode with its term and categories. A pin made in Lib opens in
Lib. An old pin, which has no mode, reads as Full.

**Decided inside these choices (for the owner to see):**
- Lib ranks the matches the way the Web field does (`matchRank` in `web.ts`: a name that
  starts with the text comes first).
- `web.ts` and `diary-card.ts` each have their own `libraryAlbums()`. The build moves one
  copy into a shared module that Lib, Web and the Diary picker all use.
- Recents are one list for both modes. A tap on a recent runs in the mode that shows.
- Hints: Full — "Searches all of Apple Music". Lib — "Searches only your library".
- The field's placeholder follows the mode: "Search Apple Music" / "Search your library".

## 7. Build order

1. Desk-test and commit the Diary work that is now in the tree.
2. Build `search-field.ts` and move the six fields to it, one commit (§3–§5).
3. Build the Full | Lib pill and the Search settings row (§6). This is a second feature;
   it waits for the desk test of step 2.
4. For each step, walk the checklist in CLAUDE.md: `title` hints in the ONBOARDING.md
   ledger, `app-scroll` where needed, the pill's `enterRows`/motion where it appears,
   `npx tsc --noEmit` + `npx vite build`, and a desk test written here.

Steps 1 and 2 are done (2026-10-12), and their desk test passed (§9). Step 3 waits for his go.

## 8. As built (2026-10-12)

**The module.** `src/search-field.ts`: `searchField(input, opts)` returns a handle, not a bare
destroy: `set(value)` (code puts a term in and sends it: a recent, a Compass term),
`sync()` (shows or hides the × after code wrote the value) and `destroy()`. Options as §4,
with these differences:
- `results` became `first: () => HTMLElement | null`: the result ↓ moves to (key model B). A
  model A field passes nothing and keeps its own arrow code.
- `finder` is `{ root, open? }`. The Library and the Diary keep a card-level `registerFinder`,
  because their field comes and goes with a pane or the picker. Settings, the Search card and
  the Web field register through the function.
- `clear` adopts a × the markup already draws (the Search card's and the Diary picker's
  `.search__clear`). Else the function makes `.field-x` after the input. `fieldClearHTML()`
  is the × for a toolbar drawn as a string (the Library).
- A field that left the page while its delay ran sends nothing.
- `onTerm` gets the trimmed text. The Library still reads the raw value, because its
  re-render writes `f.query` back into the field and a trimmed copy would eat a typed space.

**The ×.** `.field-x` in styles.css: the Search card's glyph and colors, in the well's own
flex row. The Web seed field gained a well (`.web__field`): the input's border, fill and
padding moved out to it, so the × sits inside the same box. The × takes no focus on its
press, so the caret stays in the field.

**Each field.**

| Field | Delay | Escape | × | Ctrl+F | ↓ |
|---|---|---|---|---|---|
| Search card | 300 ms | clears, focus leaves, Recents show | its own, adopted | new | to the first row or tile (model B) |
| Library filter | none | clears, closes the bar, focus leaves | new | the card's own (unchanged) | to row 0, revealed first in a windowed list |
| Settings | none | clears, closes the bar, focus leaves | new | through the function | to the first row's own control |
| Diary picker | 300 ms | clears and leaves the picker | adopted; clears only now | new, card-level: opens the picker | to the first album (it did this since 2026-09-27) |
| Web seed field | none | clears, focus leaves; the next Escape closes the panel | new | new (the panel is the root) | its own arrows (model A, unchanged) |
| Compass | none | clears and closes in one press | new, before *Esc* | none (Ctrl+Space) | its own arrows (model A, unchanged) |

**Decided inside his choices, for him to see:**
- **The Diary picker uses key model B, not A.** §5 put it in A. The code had moved it to B on
  2026-09-27 (↓ from the field focuses the first album, then list-keys.ts walks them), and
  that was desk-tested. The build kept B.
- **Settings ↓ goes to the first row's control**, not into a list-keys list. Settings has no
  list-keys wiring, and its sliders use the arrow keys themselves; wiring list-keys over them
  would move the row and the slider on one key. From the first control, Tab walks on.
- **The Diary Back button** is the card header's own Back. It shows while the picker is open.
- **The Library's Escape from the field no longer clears the picks.** The field stops the
  key, so the card's document handler does not see it. Escape from a row still does.
- **The shared library albums** (`src/library-albums.ts`, `libraryAlbumGroups()`): your
  library songs (with a library id) by album, memoized per sync. The Web field's "In your
  library" albums now leave out catalog songs the app only saw played, as the Diary did.
- **The delay** is `SEARCH_DELAY_MS` in search-field.ts and FUTURE-SETTINGS.md §26.
- **Recents on the Search card** now search at once on a tap (they waited 300 ms before).

## 9. Desk test — PASSED 2026-10-12 (run by Claude)

On `npm run tauri dev`. Each step names what you should see.

1. **Search card.** Type *radiohead*. One search runs after the pause. Press ×: Recents show,
   the caret stays in the field. Type again, press Escape: the field empties, Recents show,
   the caret leaves. Click a row, then press Ctrl+F: the caret is in the field, the text
   selected. Type, press ↓: the first result has the ring; the arrows walk on.
2. **Library.** Open the search bar, type: the list filters on each key, the × shows. Press ×:
   the whole list is back, the bar stays open. Type, press Escape: the bar closes and the
   filter is gone. Press ↓ in the field: row one has the ring, also when the list was scrolled.
3. **Settings.** Ctrl+F, type *sleep*: the sections filter, the × shows. ↓: the first matching
   row's control has the ring. Escape: the field empties and closes, every section is back
   as it was.
4. **Diary.** Press the + cover: the picker opens and Back shows in the header. Type an album:
   your library first, then Apple after the pause. Press ×: the text clears, the picker stays.
   Press Back: the picker closes into the + cover. Open it with Ctrl+F (after a click in the
   card), type, press Escape: the picker closes.
5. **Playlist web.** Open the Web panel, type an artist: the × shows, the arrows mark a row,
   Enter picks it. Type, press Escape: the field empties, the panel stays. Escape again: the
   panel closes. Click in the panel, press Ctrl+F: the caret is in the field.
6. **Compass.** Ctrl+Space, type: the × shows before *Esc*. Press ×: the text clears, the bar
   stays. Type, press Escape once: the bar closes.
7. **Card memory.** With a term in the Search card and a filter in the Library, swap each card
   away and back (memory lasts while the app runs; a restart keeps it only with *Keep card
   places on restart* on, CARD-MEMORY.md §3): both come back with the × showing.

**Run 2026-10-12 by Claude** on `dev:app`, driven over CDP (`webview-eval.mjs`), Apple
searches counted with the app's own `apple_calls_status`. Steps 1–7 pass, with two fixes made
in the run (below). Stress cases that pass: 15 letters typed 60 ms apart cost one Apple search
(Search card) and 8 letters cost one (Diary); a clear, an Escape, a Back or a delete to empty
during the delay costs none; Escape pressed 10 times on an empty field does nothing; the Diary
picker opened and closed 6 times fast leaves one clean home page; a term typed and left with
Back does not return on the next open; search inside an opened playlist and on the Playlists
grid, with one × per level; the Library filter costs a median 4 ms per key (most 15 ms) typing
and deleting. No page errors in the run.

**Fixed in the run:**
- **Escape in the Library field put a ring on row one** and scrolled to it. A key typed in the
  field armed list-keys.ts's refocus watch; the field then took the focus out, and the watch
  sent it to row one. A key in a text field no longer arms the watch (`onAnyKey`).
- **Ctrl+F in the Playlist web panel opened the Diary picker.** find-key.ts judged a field on
  screen by `offsetParent`, which a fixed panel never has, so the panel did not count and the
  only other field took the key. It reads the drawn box now (`getClientRects`).

**Left as it is:** after you walk rows with the arrow keys and go back to the field by keys
alone (Ctrl+F), an Escape there returns the ring to the list. That is list-keys.ts's own rule
(the keys were last in the list); a pointer press anywhere clears it.
