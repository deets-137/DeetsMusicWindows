---
status: idea
desk_test: none
sources: [src/donate-btn.ts, src/donate-rules.ts, docs/features/donate.md]
updated: 2026-11-04
---
# Donations — what the money pays for, and how it arrives

> An idea (2026-11-04), to talk through with him. §1 is what he said, and is fixed. §2 is what
> exists. §3 is Claude's list of questions. The button and the panel are
> [features/donate.md](../features/donate.md), dev only. Never tell a user that donations exist.

## 1. His words (2026-11-04)

- **Goals are bars in the Donate panel,** each with marks and a line of text per mark.
- **Lyrics:** a $200 bar. *$50 - 500 songs per day between all users for one month*.
  *$200 - 2000 songs per day between all users for one month*. His change, the same day:
  no donors-only perk, because $50 cannot serve everyone at full use. Both marks are for all users.
- **Apple Dev Account:** a $100 bar. *$100 - one year of apple dev access*.
- **Donations fill top to bottom.** Apple Dev is covered only after Lyrics is.
- **The method (his call, 2026-11-04):** a PayPal personal account, reached by a link in the
  Donate panel. The link opens PayPal's page in the browser.
- **The total (his call, 2026-11-04):** he updates it by hand, through the admin page, eventually.
- **To come:** a description at the top of the panel that matches this.

## 2. What exists

- **The bars and the fill rule are built, dev only.** `GOALS` in `src/donate-btn.ts` holds the
  goals in fill order. `fillGoals` in `src/donate-rules.ts` is the rule, with tests.
- **There is no real amount.** The bars show $0. `__donate.raised(250)` in DevTools shows a
  pretend amount.
- **The costs behind the marks, as known today:** Musixmatch Grow is $199 a month (the $200 mark).
  The Apple Developer Program is the $100 mark.

## 3. Questions to talk through

> **Part:** idea · 2026-11-04

1. **The PayPal page.** He makes it and sends the address. Before it goes in the app: open it in a
   private window to see if a donor can pay by card with no PayPal login, and read the address,
   because the repo is public and a personal link may show his email.
2. **The top description.** Its words, with a line that donations are not tax deductible.
3. **The period.** Lyrics is per month and Apple Dev is per year. Does the total go back to $0
   each month? If so, Apple Dev fills only in a month that passes $200, and its $100 must carry
   over from month to month. Or is it one running total, spent in order?
4. **The $50 mark.** 500 songs a day between all users (his call). Which Musixmatch plan gives
   that for $50? Grow is $199 a month and 2,000 calls a day.
5. **The daily limit.** What does a user see when the day's songs run out?
6. **The amount in the app.** He writes it by hand on the admin page (§1). How does the panel read
   it? DeetsSupport's `GET /config?app=deetsmusic` is an existing route (CSP.md), and it reads a D1
   overlay as well as the `CONFIG` var, so the number may change with no deploy. Test this first.
7. **More than the goals.** What do the bars show when money passes the last goal?

## 4. The method: what was read (2026-11-04)

> **Part:** idea · 2026-11-04

With no donor perk (his call, 2026-11-04), PayPal's Donate button is open, and nothing needs to
prove who donated. **Closed the same day: a PayPal personal account and a link (§1).** The table
is what led there. Move to a business account if the card test fails or he wants an automatic
total.

| Service | Fee | Read from | Result |
|---|---|---|---|
| Ko-fi | 0 % on one-time tips, plus the processor's fee; 5 % on memberships without Gold | Reviews only: Ko-fi's own help page refused the fetch. Check on ko-fi.com | Open. Webhook only, from one source |
| Paddle, Lemon Squeezy | About 5 % + $0.50 a payment. They take on the sales tax | Comparison blogs. Pay-what-you-want not confirmed | Open |
| PayPal Donate button (FontForge's way, his find) | Not confirmed: sources say about 2.9 % + $0.30 to $0.49 | User Agreement of 2026-09-14, as quoted by ConductAtlas: PayPal's own page refused the fetch. Do "not use the Donate Button … for the sale of goods and services" | Open: the perk is gone. FontForge's page has no perks either |
| GitHub Sponsors | 0 % from personal accounts | docs.github.com | Dropped: a sponsorship is made from a GitHub account, and a listener has none |
| Stripe, direct | Not confirmed | Stripe's tips and donations page | Dropped: a donation must be tied to a charitable purpose, and a tip must be for something already given |

**PayPal in the app (read 2026-11-04).**
- **The Donate SDK exists** (`developer.paypal.com/sdk/donate`): a script from
  `paypalobjects.com` draws a button, and a pop-up takes the donation over the page.
- **Not in the panel.** PayPal: "PayPal recommends against loading your own site in a web view.
  This integration style is unsupported." The app's CSP (`script-src` is the app and Apple,
  `frame-src` is `'none'`) would also have to open for an outside script, in the page that holds
  the user's Apple Music token. So the panel opens PayPal's page in the browser.
- **A link, not a button (his ask):** the account row's text link family (`.account__link`), as
  *All release notes*. It waits for the page's address.
- **Account:** a personal account is enough to start. It cannot update its page afterward, and
  the page's card option for a donor with no PayPal account is not confirmed on it (test the link
  in a private window). Live webhooks and API keys need a verified Business or Premier account, so
  the automatic total would need the upgrade. Eligible if `paypal.com/donate/buttons` lets him
  start a button.
- **An automatic total, if he ever wants one:** PayPal has webhooks and a Transaction Search API,
  but which event a Donate button sends is not confirmed, and it needs the business account.

**What follows.**
- The panel opens the page in the browser (`openUrl`, as *All release notes* does). The app never
  touches a card, and the CSP needs no new host.
- Donors get no tax deduction. Whether donations are gifts or income to him is not settled: plan
  on income, keep PayPal's history and the Musixmatch and Apple receipts, and ask an accountant
  before launch.
- Say in the panel that lyrics for all users is what the money pays for, and no donor gets a
  perk, so a donation stays a donation.
