// Search fields (SEARCH-FIELDS.md §3–§5) — one behavior for every text box that filters or
// searches as you type: the Search card, the Library filter (every collection card), Settings,
// the Diary picker, the Playlist Web seed field and the Compass. What each field searches and
// how it draws its results stay the field's own; this owns the parts that were six copies:
//
//   ×          a clear button inside the field, hidden while it is empty; a press clears the
//              text and keeps the focus in the field
//   Escape     one press clears the text and closes the field (`onClose`; a field that is
//              always on screen loses the focus instead). The key stops here, so a panel or a
//              card behind the field does not also react to it.
//   Ctrl+F     the field registers with find-key.ts when it lives as long as its card
//   the delay  `SEARCH_DELAY_MS` for a field that calls Apple as you type; a local filter is
//              instant. An empty field is sent at once either way.
//   ↓          from the field to the first result, for a field whose results are a card's own
//              list (key model B, §5: list-keys.ts walks the rows from there). A field whose
//              results drop down under it (model A: the Compass, the Web field) keeps the caret
//              in the field and walks its rows with its own keys.

import { registerFinder } from "./find-key";

/** The pause in typing before a field that calls Apple searches (FUTURE-SETTINGS.md). */
export const SEARCH_DELAY_MS = 300;

export interface SearchFieldOptions {
  /** The trimmed text: after the delay, or at once. */
  onTerm: (term: string) => void;
  /** "apple": wait `SEARCH_DELAY_MS` after the last key. Default "none". */
  delay?: "apple" | "none";
  /** Escape, after the clear: close the field. Without it, Escape takes the focus out. */
  onClose?: () => void;
  /** The field's own × when its markup already draws one; else one is made after the input. */
  clear?: HTMLButtonElement;
  /** Ctrl+F: the card root it answers for, and how to show the field (default: focus it). */
  finder?: { root: HTMLElement; open?: () => void };
  /** ↓ in the field: the result that takes the focus (key model B). */
  first?: () => HTMLElement | null;
}

export interface SearchField {
  /** Put text in the field from code (a term from the Compass, a restored card) and send it. */
  set(value: string): void;
  /** Show or hide the × after code wrote the field's value without `set`. */
  sync(): void;
  destroy(): void;
}

const X_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/** The × for a field whose markup is drawn as a string and rebuilt (the Library's toolbar). */
export function fieldClearHTML(shown: boolean): string {
  return `<button class="field-x" type="button" aria-label="Clear search" title="Clears the search"${shown ? "" : " hidden"}>${X_SVG}</button>`;
}

export function searchField(input: HTMLInputElement, o: SearchFieldOptions): SearchField {
  let x = o.clear ?? input.parentElement?.querySelector<HTMLButtonElement>(":scope > .field-x") ?? null;
  const made = !x;
  if (!x) {
    const tmp = document.createElement("div");
    tmp.innerHTML = fieldClearHTML(false);
    x = tmp.firstElementChild as HTMLButtonElement;
    input.after(x);
  }
  const clearBtn = x;
  let timer = 0;

  const sync = (): void => {
    clearBtn.hidden = !input.value;
  };
  const send = (): void => {
    window.clearTimeout(timer);
    if (!input.isConnected) return; // the field left the page while its delay ran
    o.onTerm(input.value.trim());
  };
  const onInput = (): void => {
    sync();
    window.clearTimeout(timer);
    if (o.delay === "apple" && input.value.trim()) timer = window.setTimeout(send, SEARCH_DELAY_MS);
    else send();
  };
  const clear = (): void => {
    if (!input.value) return;
    input.value = "";
    sync();
    send();
  };
  const onClear = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation(); // a card's own click handler never sees the × as a press on the card
    clear();
    input.focus();
  };
  // The × takes no focus on its press, so the caret stays in the field.
  const onClearDown = (e: PointerEvent): void => e.preventDefault();
  const onKey = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      clear();
      if (o.onClose) o.onClose();
      else input.blur();
      return;
    }
    if (e.key === "ArrowDown" && o.first) {
      const el = o.first();
      if (!el) return;
      e.preventDefault();
      if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
    }
  };

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKey);
  clearBtn.addEventListener("click", onClear);
  clearBtn.addEventListener("pointerdown", onClearDown);
  const unsubFind = o.finder
    ? registerFinder(
        o.finder.root,
        o.finder.open ??
          (() => {
            input.focus();
            input.select();
          }),
      )
    : () => {};
  sync();

  return {
    set(value) {
      input.value = value;
      sync();
      send();
    },
    sync,
    destroy() {
      window.clearTimeout(timer);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKey);
      clearBtn.removeEventListener("click", onClear);
      clearBtn.removeEventListener("pointerdown", onClearDown);
      unsubFind();
      if (made) clearBtn.remove();
    },
  };
}
