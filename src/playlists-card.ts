// Playlists card — a stub for now, so it's selectable in the slot picker (which exercises
// the swap/replace machinery with three cards for two slots). The real collection-card
// Playlists context — overview → playlist detail — lands in a later session.

import type { CardDef } from "./cards";

export const playlistsCard: CardDef = {
  id: "playlists",
  title: "Playlists",
  mount(host) {
    host.innerHTML = `
      <header class="panel__head"><h2 class="panel__title">Playlists</h2></header>
      <div class="panel__body card-stub"><p class="card-stub__msg">Playlists coming soon.</p></div>`;
    return {
      destroy() {
        host.innerHTML = "";
      },
    };
  },
};
