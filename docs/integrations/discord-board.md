---
status: project
desk_test: none
sources: []
updated: 2026-11-05
---
# DeetsMusic — the support boards and Discord threads

> **Part:** project · 2026-11-05 · forks §10. Not built. Do not tell a user that this exists.

Each public post on the support boards gets a thread in the DeetsMusic Discord server. The web
and Discord show the same post and the same replies. A bot keeps the two sides the same.

**Terms.** A *post* is a row in `posts` in DeetsSupport: a bug (`kind` `issue`) or a suggestion.
A *board* is the public list on deets.solutions. A *thread* is one post in a Discord forum
channel. The *sync worker* is the new worker in §6.

## 1. What he asked for

His words, 2026-11-05: "connecting web links of each post / suggestion / bug to a discord thread
... with the bot managing the discord side of things allowing parity between web and disc".

## 2. His decisions (2026-11-05)

1. **A bug filed in Discord is open.** Anyone posts a bug directly in the forum. No form, and no
   wait for his approval. The other choice was a form that sent the bug to his private queue.
2. **A Discord person shows on the web as their Discord name, with a Discord mark.** They need
   no DeetsAccounts sign-in. The other choice was to link an account first.

What follows from decision 1: a bug filed in Discord is public on the web too (`public = 1`). If
it stayed private on the web, the two sides would differ. A bug filed on the web or in the app
still waits for him (§3). That bug can carry a log tail, and a Discord post cannot.

## 3. What exists today

Read from `../DeetsSupport` on 2026-11-05.

- A bug lands with `public = 0` and waits for him. A suggestion lands with `public = 1` and stays
  up until he strikes it (`src/index.js`, the header comment and `handleCreatePost`).
- A post has two ids. `pid` is public. `code` is the reporter's credential and is never public.
  `meta` holds the log tail. `uid` is never sent out.
- `replies.author` is `owner`, `reporter` or `member`. It has no CHECK rule, so a new value needs
  no change to the column.
- `blocked` is keyed by `uid`, and `/admin/block` hides every row with that `uid`.
- `BODY_MAX` is 4000. `NAME_MAX` is 24. Fixed, wontfix and closed are the closed states
  (`CLOSED_STATES`).
- `interest` is an anonymous counter. A poll vote needs a DeetsAccounts sign-in.
- The worker has no Durable Object. Its cron runs every 5 minutes. It holds no live sockets, so
  a deploy drops nothing.

The Discord server has no forum channel yet, and Community is off (§9).

## 4. What each side does

| Event | The other side |
|---|---|
| A post becomes public on the web | The bot opens a thread. The first message carries the title, the body and the `#p=<pid>` link. |
| A post is filed in Discord | The web gets a post with `source = 'discord'` and `public = 1`. The thread gets the `#p=<pid>` link. |
| A reply on the web | The bot posts it in the thread through a webhook, under the commenter's name. |
| A reply in the thread | The web gets a reply with `author = 'discord'`, within seconds (§6). |
| He hides a reply on the web | The bot deletes the Discord message. |
| A Discord message is deleted | The web reply is hidden. |
| A Discord message is edited | The web reply takes the new text and sets `edited_at`. |
| He edits a post or his reply | The bot edits the Discord message. |
| He strikes or deletes a post | The bot deletes the thread. The archive keeps the post as it does now. |
| The post's state changes | The forum tag changes. A closed state locks and archives the thread. |
| The thread's tag changes, by him | The web state changes. Only he can do this. |
| The poster closes their own thread | The web state becomes `closed`, as the `code` holder can do today. |
| A reaction on the first message | `interest` goes up by one. Taking it off takes one away. |
| A poll on the web | The poll stays on the web. The thread links to it (§5.3). |

The bot edits the first message of the thread to show the total `interest`, so the number is the
same on both sides.

**A thread never exists for a private post.** The bot reads `public` before each write. `code`,
`meta` and `uid` never reach Discord.

## 5. Identity

### 5.1 The name and the mark
- `replies.name` takes the Discord display name at post time, cut to `NAME_MAX`. A later rename
  does not rewrite it. This is the rule for a member's name now.
- The site and the app draw a Discord mark beside the name. The mark links to the thread.
- `replies.color` stays empty.

### 5.2 The block
- `uid` takes `discord:<their Discord user id>`. A `discord:` value cannot match a DeetsAccounts
  id.
- This makes the `blocked` table and `/admin/block` work with no change: the block hides their
  replies, and the sync worker refuses their new ones. The sync worker also deletes the message.
- The rule that `uid` is never sent out holds for this value too.

### 5.3 What a Discord person cannot do
- They cannot vote in a web poll. A vote needs a DeetsAccounts sign-in. This is the cost of
  decision 2.

## 6. How the two sides talk

**Web to Discord.** `deets-support` calls Discord's REST API after the D1 write, in
`ctx.waitUntil`, never awaited by the response. A Discord fault can never slow or fail a board
write. A call that fails goes in the outbox (§7), and the 5-minute cron sends it again.

**Discord to web.** A reply must arrive when it happens, and only a live gateway connection
gives that. `deets-support` has no Durable Object and must stay that way (its header says so).
So a **new worker** holds the connection in one Durable Object. It writes to the `deets-support`
D1 through its own binding. Its deploy drops only its own connection, and it picks up where it
stopped (the next paragraph).

**The catch-up.** The sync worker keeps the last Discord message id per thread. After a
reconnect, it reads each open thread from that id. Nothing is lost while the connection is down.

**No loops.** The sync worker skips a message that has our webhook id or our bot's id. Each row
stores its Discord message id, so a retry edits a message and never writes a second one.

**The `#p=` link and the mark** need a change in the DeetsSolutions site.

## 7. Data

One migration in `../DeetsSupport/migrations`:

```sql
ALTER TABLE posts   ADD COLUMN thread_id  TEXT;  -- the Discord thread; NULL = no thread
ALTER TABLE replies ADD COLUMN discord_id TEXT;  -- the Discord message of this row
CREATE TABLE discord_outbox (                    -- what still has to reach Discord
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE discord_cursor (                    -- the last message read, per thread
  thread_id TEXT PRIMARY KEY, last_id TEXT NOT NULL
);
```

`posts.source` gains `discord`, `replies.author` gains `discord`, and `SOURCES` gains its value
only inside the sync worker's write. The public `POST /posts` must not accept `source: discord`.

A worker reads these columns with a fallback, as `withEdited` does, so a deploy before the
migration still reads every post.

**Sizes.** A Discord message holds 2000 characters and `BODY_MAX` is 4000. A longer text goes in
an embed, which holds 4096, so one row stays one message. A thread name holds 100 characters;
the build checks `TITLE_MAX` against that.

## 8. Security and privacy

- **A separate bot.** The sync worker and `deets-support` hold the token of a new bot with only
  the permissions they need. They never hold the DeetsOTD bot's token. That token has Administrator
  on this server and reaches his three friend servers. A leak from a public worker must not reach
  those.
- **No pings.** Each message from the web sets `allowed_mentions` to none, so a web comment cannot
  ping `@everyone`.
- **Text only.** The boards are text in, text out. A Discord attachment does not copy to the web;
  the web reply shows a link to the thread. Discord's file links expire.
- **A pinned notice** in each forum says that posts and replies there show on the public board.
- **Spam.** A suggestion is public at once, so spam reaches Discord at once. The intake breaker
  still counts it. A strike deletes the thread (§4). Discord posts count against the same breaker,
  and `KILL_BOARDS` stops the sync worker's writes too.
- **Message Content.** Reading the text of a reply needs this intent. A bot in under 100 servers
  turns it on in the developer portal.

## 9. The server

Measured with the bot on 2026-11-05: 2 members, no rules channel, Community off, verification and
the content filter at their lowest. Discord says a forum channel needs Community. Community needs
a rules channel, an updates channel and higher safety settings. This is the first setup step.

## 10. Open

Small forks for the build. Each goes to him first.

1. The forums: one forum with Bug and Suggestion tags, or two forums. Their names.
2. The new bot's name and picture.
3. The words of the pinned notice.
4. The Discord mark on the site and in the app: its look and place.
5. Does a closed post's thread stay readable, or leave the list? Discord archives it, and the
   web keeps it.

## 11. Desk test

To write when the build starts. It must cover: a private bug makes no thread; a reply on each side
reaches the other; a retry makes no second message; a reply sent while the connection is down
arrives after it; a web comment with `@everyone` pings nobody; a block on each side; a strike
deletes the thread.
