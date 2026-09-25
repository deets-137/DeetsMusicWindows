---
status: designed
desk_test: none
sources: [src/search-card.ts, src/radio.ts, src/collection-card.ts, src/settings-card.ts, src/diary-card.ts, src/web.ts, src/compass.ts, src/find-key.ts, src/list-keys.ts]
updated: 2026-09-24
---
# DeetsMusic — Search fields

> **Status (2026-09-24): DESIGNED, not built.** The owner decided every fork in §3, §5 and
> §6 on 2026-09-24. The build waits until the Diary work in the tree is desk-tested and
> committed, because both change `src/diary-card.ts` (§7).

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
