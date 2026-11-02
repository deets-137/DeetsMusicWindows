---
status: foundation
desk_test: none
sources: [docs/legal/apple-dpla-2026-10-01-english-uk.pdf, docs/legal/apple-dpla-2026-10-01-english-uk.txt]
updated: 2026-11-01
---
# The Apple Developer Program License Agreement — the copy we read

**A record (2026-11-01, his ask).** The agreement the app's use of MusicKit JS runs under, saved
here so a later reading does not depend on Apple's site. The two clauses the project has weighed
are quoted below, word for word from this copy. The risk decisions themselves are not here: the
accepted §7.6 risk is recorded in the memory of 2026-09-13 and referred to by
[PROVIDERS.md](../integrations/PROVIDERS.md) §9 and [SupportArtist.md](../ideas/SupportArtist.md)
§4; the puck's reading is [DeetsPod.md](../ideas/DeetsPod.md) §6.

## 1. The files

| File | What it is |
|---|---|
| `apple-dpla-2026-10-01-english-uk.pdf` | The English (UK) edition, 130 pages, "effective as of 1 October 2026". Downloaded 2026-11-01 from the link below. |
| `apple-dpla-2026-10-01-english-uk.txt` | Its text, extracted with pypdf the same day, for grep. Curly quotes came out as `�`. |

**Links.**
- The copy saved here (served without a developer sign-in):
  <https://developer.apple.com/support/downloads/terms/apple-developer-program/Apple-Developer-Program-License-Agreement-English-UK.pdf>
- The dated English (US) edition of 2025-10-08, which returns a sign-in page without a developer
  session: <https://developer.apple.com/support/downloads/terms/apple-developer-program/Apple-Developer-Program-License-Agreement-20251008-English.pdf>
- Apple's landing page for the agreement: <https://developer.apple.com/programs/apple-developer-program-license-agreement/>

Apple revises the agreement several times a year. Check the "effective as of" line before a new
reading, and save the new copy beside this one rather than over it.

## 2. §7.6 — No Other Distribution Authorised Under this Agreement

> Except for the distribution of Licensed Applications through the App Store or Custom App
> Distribution in accordance with Sections 7.1 and 7.2, the distribution of Applications for use on
> Registered Devices as set forth in Section 7.3 (Ad Hoc Distribution), the distribution of
> Applications for beta testing through TestFlight as set forth in Section 7.4, the distribution of
> Libraries in accordance with Section 7.5, the distribution of Passes in accordance with
> Attachment 5, the delivery of Safari Push Notifications on macOS, the distribution of Safari
> Extensions on macOS, the distribution of Applications and libraries developed for macOS and/or
> as otherwise permitted herein, no other distribution of programs or applications developed using
> the Apple Software is authorised or permitted hereunder. In the absence of a separate agreement
> with Apple, You agree not to distribute Your Application for iOS, iPadOS, tvOS, visionOS or
> watchOS to third parties via other distribution methods or to enable or permit others to do so.
> You agree to distribute Your Covered Products only in accordance with the terms of this Agreement.

**Reading (2026-11-01).** The hard sentence names Apple's own platforms; Windows is not in the
list, and macOS apps are expressly allowed outside the store. The exposure for a Windows app
built on MusicKit JS is the catch-all sentence ("no other distribution of programs or
applications developed using the Apple Software"). The same footing Cider stands on. The risk
was accepted on 2026-09-13 and is not re-raised.

## 3. §3.3.6 D — MusicKit

> You agree not to call the MusicKit APIs or use MusicKit JS (or otherwise attempt to gain
> information through the MusicKit APIs or MusicKit JS) for purposes unrelated to facilitating
> access to Your end users' Apple Music subscriptions. If You access the MusicKit APIs or
> MusicKit JS, then You must follow the Apple Music Identity Guidelines. You agree not to require
> payment for or indirectly monetise access to the Apple Music service (e.g. in-app purchase,
> advertising, requesting user info) through Your use of the MusicKit APIs, MusicKit JS or
> otherwise in any way. In addition:
>
> - If You choose to offer music playback through the MusicKit APIs or MusicKit JS, full songs
>   must be enabled for playback, and users must initiate playback and be able to navigate
>   playback using standard media controls, such as "play", "pause" and "skip", and You agree to
>   not misrepresent the functionality of these controls;
> - You may not, and You may not permit Your end users to, download, upload or modify any
>   MusicKit Content and MusicKit Content cannot be synchronised with any other content, unless
>   otherwise permitted by Apple in the Documentation;
> - You may play MusicKit Content only as rendered by the MusicKit APIs or MusicKit JS and only
>   as permitted in the Documentation (e.g. album art and music-related text from the MusicKit
>   API may not be used separately from music playback or managing playlists);
> - Metadata from users (such as playlists and favourites) may only be used to provide a service
>   or function that is clearly disclosed to end users and that is directly relevant to the use of
>   Your Application, website or web application, as determined at Apple's sole discretion; and
> - You may use MusicKit JS only as a standalone library in Your Application, website or web
>   application and only as permitted in the Documentation (e.g. You agree not to recombine
>   MusicKit JS with any other JavaScript code or separately download and re-host it).

The definitions the clause rests on (the agreement's Section 1): *MusicKit APIs* "means the set
of APIs that enable Apple Music users to access their subscription"; *MusicKit Content* "means
music, video and/or graphical content rendered through the MusicKit APIs"; *MusicKit JS* "means
the JavaScript library that enables Apple Music users to access their" subscription.

## 4. What is not here

The user-side **Apple Media Services Terms and Conditions** (personal, non-commercial use of the
content, the devices it may play on) were not read for this record. They are the second,
smaller question for any feature that moves the sound off the PC (DeetsPod.md §6).
