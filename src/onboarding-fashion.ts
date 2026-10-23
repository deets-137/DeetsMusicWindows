// Page 3 of the grand opening (docs/features/GRAND-OPENING.md §8): "Fashion" — what's your music
// listening vibe? Three columns: the skin, the theme, and the preview player (onboarding-preview.ts,
// §8b): the Now Playing card in the look picked, with his three songs.
//
// Each choice is drawn IN its own look: a tile carries `data-skin` and `data-theme`, and the skin
// and theme blocks (skin.css, themes.css) are attribute selectors, so the tile's small card takes
// that look's real fill, edge, corners, shadow and type. A skin tile wears the theme you have;
// a theme tile wears the skin you have, so the two columns answer "this one, with mine". The
// title menu's own flyout items do the same (index.html). The names and hints are read from the
// title menu's buttons, so a skin or theme added there shows here.
//
// A pick is the title menu's: `pickLook` (look.ts), your value, through the look's own crossfade.

import type { CardInstance } from "./cards";
import { pickLook } from "./look";
import { effective, onSettingsChange } from "./settings-store";
import type { SkinName, ThemeName } from "./look-ids";
import { mountPreview } from "./onboarding-preview";
import * as diag from "./diag";

/** The words on the page (his, 2026-10-22). */
const COPY = { title: "Fashion", sub: "What's your music listening vibe?" };

interface Choice { id: string; label: string; hint: string }
/** The title menu's choices, in its order (Vanilla is not offered there, so not here). */
const choicesOf = (attr: "data-skin-choice" | "data-theme-choice"): Choice[] =>
  [...document.querySelectorAll<HTMLElement>(`#settings-menu [${attr}]`)].map((el) => ({
    id: el.getAttribute(attr)!,
    label: el.textContent?.trim() ?? "",
    hint: el.title,
  }));

/** One tile: a small card in the look `skin` × `theme`, its name under it. */
function tile(kind: "skin" | "theme", c: Choice, skin: string, theme: string, on: boolean): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "onboarding__pick onboarding__lookpick";
  b.dataset.lookKind = kind;
  b.dataset.lookId = c.id;
  b.title = c.hint;
  b.setAttribute("aria-pressed", String(on));
  b.innerHTML =
    `<span class="onboarding__look" aria-hidden="true">` +
    `<span class="onboarding__look-card"><i class="onboarding__look-cover"></i>` +
    `<span class="onboarding__look-text"><b class="onboarding__look-aa">Aa</b><i class="onboarding__look-line"></i></span></span>` +
    `</span><span class="onboarding__pick-label"></span>`;
  const look = b.querySelector<HTMLElement>(".onboarding__look")!;
  look.dataset.skin = skin;
  look.dataset.theme = theme;
  b.querySelector(".onboarding__pick-label")!.textContent = c.label;
  return b;
}

export function mountFashion(host: HTMLElement): CardInstance {
  host.innerHTML =
    `<div class="onboarding__sheet app-scroll">` +
    `<header class="onboarding__hello"><h1 class="onboarding__hi"></h1><p class="onboarding__sub"></p></header>` +
    `<div class="onboarding__cols">` +
    `<section class="onboarding__col" data-col="skin"><h2 class="panel__title">Skin</h2><div class="onboarding__picks" data-picks="skin"></div></section>` +
    `<section class="onboarding__col" data-col="theme"><h2 class="panel__title">Theme</h2><div class="onboarding__picks" data-picks="theme"></div></section>` +
    // §8b: the player in the look picked, with his three songs (onboarding-preview.ts).
    `<section class="onboarding__col" data-col="preview"><h2 class="panel__title">Preview</h2><div data-preview></div></section>` +
    `</div></div>`;
  host.querySelector(".onboarding__hi")!.textContent = COPY.title;
  host.querySelector(".onboarding__sub")!.textContent = COPY.sub;

  const skinBox = host.querySelector<HTMLElement>('[data-picks="skin"]')!;
  const themeBox = host.querySelector<HTMLElement>('[data-picks="theme"]')!;
  const skins = choicesOf("data-skin-choice");
  const themes = choicesOf("data-theme-choice");

  // The look on screen (a rule's or the schedule's, else yours): the pressed tiles, and the
  // other half of each tile's look.
  const paint = () => {
    const skin = effective("skin");
    const theme = effective("theme");
    skinBox.replaceChildren(...skins.map((c) => tile("skin", c, c.id, theme, c.id === skin)));
    themeBox.replaceChildren(...themes.map((c) => tile("theme", c, skin, c.id, c.id === theme)));
  };
  const onPick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-look-kind]");
    if (!b) return;
    const id = b.dataset.lookId!;
    diag.log("onboarding:look", { [b.dataset.lookKind!]: id });
    pickLook(b.dataset.lookKind === "skin" ? { skin: id as SkinName } : { theme: id as ThemeName });
  };
  skinBox.addEventListener("click", onPick);
  themeBox.addEventListener("click", onPick);

  paint();
  const off = onSettingsChange((k) => {
    if (k === "theme" || k === "skin") paint();
  });
  const preview = mountPreview(host.querySelector<HTMLElement>("[data-preview]")!);

  return {
    destroy() {
      preview.destroy();
      off();
      host.replaceChildren();
    },
  };
}
