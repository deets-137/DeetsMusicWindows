// Page 5 of the grand opening (docs/features/GRAND-OPENING.md §11): "You're Ready" — a letter
// from him. The title, the subtitle and the letter are his (2026-10-23). Changed with his OK the
// same day: the typo "connectiosn"; his employer's name taken out; the record-company line
// softened to "a peek behind the curtain"; paragraph 2 his rewrite, with a struck-through joke;
// the "little stuff" paragraph after the Bandcamp line. The words live only here.

import type { CardInstance } from "./cards";

/** A paragraph: plain words, or words with a struck-through part (`<s>`) and what follows it. */
type Para = string | { text: string; struck: string; after: string };

const COPY: { title: string; sub: string; greeting: string; letter: Para[]; closing: string; sign: string } = {
  title: "You're Ready",
  sub: "A Final Message",
  greeting: "Hi Friends,",
  letter: [
    "You're set up and mostly ready to go. I hope you enjoy the experience start to finish and my passion carries through. There's so many features buried in that the onboarding can't cover too well, from playlist webs (a chance to escape the algorithm) to a rules engine to a Song of the Day tracker with Discord webhooks.",
    {
      text: "I'm an inherently curious person. At a massive software company in a field as complex as healthcare, my secret weapon was clicking random buttons to put together the bigger picture and see what happens. It taught me there's real truth to \"the customer is always right\": if something feels off to you, it probably is. Why? It was made for you and your curiosity might help uncover a problem before the next person sees it. If a button doesn't behave as you'd expect, do what you want, or if anything breaks, let me know! Be curious with me and hover everything, click everything. That's how we build this into something that gets the big companies paying attention to user experience ",
      // A joke, struck through on purpose (his ask).
      struck: "(smth smth Marvel Rivals kicking Overwatch into one of its greatest years imo)",
      after: ".",
    },
    "We've all seen the Windows version of Apple Music. Little slow, breaks on changing audio outputs, bugs that may be older than I am (jk but you get what I mean), and other quirks that hinder what music could be and mean.",
    "Imagine Apple gave us a lossless audio stream, gave us access to real time lyrics synced with the audio it provides (or timestamped lyrics for the dev (me!) to figure out implementation of), gave us listening stats (I love last.fm, but I fear for certain genres the numbers aren't as accurate), let us tune our own algorithm (I love artist communities and listening to music by my fav artist's friends, but maybe you prefer to match by BPM), gave us a peek behind the curtain at how their algorithms and lists get made, or more. But here's the thing, we shouldn't have to rely on one company to do it, we got a community! Imagine we had direct Bandcamp streams / connections for you to support artists too.",
    // The walls he hit, from the docs (FAVORITES.md, PLAYLISTS.md, DESIGN.md, CREDITS.md,
    // SpotifyRooms.md): drafted by Claude, his OK 2026-10-23.
    "Or even the little stuff: removing a song from your library, renaming a playlist on Apple Music, crossfading between songs, seeing who produced a track, or matching a song for a friend on Spotify so they can join your room. The tools these companies give us don't let us do any of that yet (trust me, I tried!).",
    "I'm of the opinion we can accomplish all this and more, do I have the connections or community backing to get any of that done? Not yet, but I believe. Let me know what you'd need to convince or help you use DeetsMusic as a daily driver, and I'll try to get it done.",
  ],
  closing: "Thanks,",
  sign: "Deets",
};

export function mountLetter(host: HTMLElement): CardInstance {
  host.innerHTML =
    `<div class="onboarding__sheet app-scroll">` +
    `<header class="onboarding__hello"><h1 class="onboarding__hi"></h1><p class="onboarding__sub"></p></header>` +
    `<div class="onboarding__letter"></div></div>`;
  host.querySelector(".onboarding__hi")!.textContent = COPY.title;
  host.querySelector(".onboarding__sub")!.textContent = COPY.sub;
  const body = host.querySelector<HTMLElement>(".onboarding__letter")!;
  const para = (t: Para, cls?: string) => {
    const p = document.createElement("p");
    if (cls) p.className = cls;
    if (typeof t === "string") p.textContent = t;
    else {
      const s = document.createElement("s");
      s.textContent = t.struck;
      p.append(t.text, s, t.after);
    }
    body.append(p);
  };
  para(COPY.greeting);
  COPY.letter.forEach((t) => para(t));
  para(COPY.closing);
  para(COPY.sign, "onboarding__sign");
  return {
    destroy() {
      host.replaceChildren();
    },
  };
}
