---
status: designed
desk_test: none
sources: [src-tauri/src/sotd/outlet.rs, src-tauri/src/sotd/outbox.rs, src-tauri/src/diary.rs]
updated: 2026-10-08
---
# DeetsMusic — Threads outlet: Songs of the Day and Diary reviews

> **Part:** designed · 2026-10-08. Not built. Three forks decided by the owner (§2). The forks
> in §8 are open. Do not tell a user that this exists.

## 1. What it is
A Threads outlet posts from DeetsMusic to the owner's Threads account. It posts two things:
- **A Song of the Day pick.** This is one post, the same pick that the Discord webhook outlet
  sends (DeetsOTD.md §3G).
- **A Diary review.** This is a thread chain made from the Diary Export text (DIARY.md §10).

It is one more outlet in `src-tauri/src/sotd/outlet.rs`. It uses the existing parts: the
DPAPI store, the on/off switch, the outbox that does not retry in a loop, `post` and
`delete_post`. It is not a new system.

## 2. Decisions (owner, 2026-10-08)
1. **Who: only the owner, as a Threads tester.** The Meta app stays in development mode. No
   App Review. App Review comes later, if ever. The feature is mainly for personal use.
2. **A long Diary review posts as a thread chain:** a first post, then replies to it.
3. **No image.** The Apple Music link makes the preview card (`link_attachment`). The app
   never uploads or links Apple cover art. This is the same rule as Bluesky (DeetsOTD.md §3G).

## 3. The Threads API (facts the design uses)
- **Hosts:** `graph.threads.net` (also `graph.threads.com`), version `v1.0`.
- **Posting takes two calls:**
  1. `POST /me/threads` with `media_type=TEXT`, `text`, and optional `link_attachment` (a URL
     that gets a preview card) or `reply_to_id` (makes the post a reply). It returns a
     container id.
  2. `POST /me/threads_publish` with `creation_id=<container id>`. It returns the post id.
- **Text limit:** 500 characters per post.
- **Limits per 24 h:** 250 posts, 1,000 replies, 100 deletes. A chain of 6 uses 1 post and 5
  replies. These limits do not matter here.
- **Permissions:** `threads_basic`, `threads_content_publish`, `threads_manage_replies` (for
  the chain replies), `threads_delete` (for `delete_post`).
- **Sign-in:** OAuth 2 in the browser (`threads.net/oauth/authorize`) with an HTTPS redirect
  URI that is registered on the Meta app. The code gives a short-lived token (1 h). An exchange
  gives a long-lived token (60 days). A refresh call extends it by 60 days. The token must be
  more than 24 h old to be refreshed.
- **Testers:** in development mode, only accounts with the Threads Tester role can sign in. The
  owner adds the account in the Meta app dashboard, then accepts the invite in Threads
  (Settings › Account › Website permissions › Invites).

## 4. Sign-in and the app secret
The code exchange needs the Meta **app secret**. The repo is public (MIT), so the secret never
goes in the app. It sits on a worker.
- **The worker:** DeetsSupport gets one route that takes the code, calls Meta with the secret,
  and returns the long-lived token. It stores nothing. A deploy is the owner's call
  (CLAUDE.md › Conventions).
- **The redirect page:** a page on deets.solutions takes the code and hands it to the app
  through the `deetsmusic://` deep link, the same way that Apple sign-in does.
- **In the app:** the token goes in the outlet's DPAPI store (`outlet.rs`). The app refreshes
  it when it is older than 30 days. If the refresh fails, the outlet shows "Sign in again" and
  queued posts wait.
- `diag.log` the connect, the refresh and each post (outlet, kind, result), never the token.

## 5. A Song of the Day post
One post: the pick's line text, with the song's Apple Music link as `link_attachment`. The
text never goes over 500 characters. The rules for every outlet apply (DeetsOTD.md §3G): off by
default, a preview of the exact text before the first post, then **Ask each time** | **Post my
picks**.

## 6. A Diary review (the thread chain)
- **Source:** the Diary Export text (`export_text` in Rust), so the words are the same on every
  path.
- **Post 1:** the album, the artist, the overall score, the album's Apple Music link as
  `link_attachment`.
- **Posts 2 to N:** replies, each one to the post before it, so the chain reads in order. Text
  splits at section breaks first, then at sentence ends. A part never goes over 500 characters.
- **Order:** publish one at a time. Each reply needs the post id of the one before it.
- **A failure partway:** the posts that went out stay. The outbox keeps the rest with the last
  post id, and sends them on the next try. It does not start a new chain.
- **The trigger:** a Diary action ("Post to Threads"), always with a preview of every part.
  It never posts on its own when an entry is marked done.

## 7. Not in this design
- App Review and use by other people (stranger parity). When the owner wants it, the work is the
  review submission and a privacy policy page. The code does not change.
- Images and carousels.
- Reading replies or showing them in the app.

## 8. Open forks (the owner decides)
1. **Where the Diary action sits:** in the entry's right-click menu next to Export, a button in
   the entry's header, or both.
2. **How a chain splits:** one post per scored song, or the fewest posts that hold the text.
3. **Undo:** does deleting a chain from the app delete every post (one `threads_delete` each),
   or only the first post?
4. **The Settings row:** in the Song of the Day section with the other outlets, or a new
   "Threads" row in Connections.
5. **Wording:** the button, the preview title, the toast text (TOASTS.md §5 when built).

## 9. Desk test (to write when built)
Sign in as the tester. Post a Song of the Day pick and check the link card. Post a Diary entry
with a long note and check the chain order and the 500-character splits. Break the network
after post 2 and check that the next try finishes the same chain. Wait for a token refresh, or
force one.
