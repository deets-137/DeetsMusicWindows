---
status: idea
desk_test: none
sources: []
updated: 2026-09-21
---
# Matter lights — an on/off panel

Researched 2026-09-20/21. **Not built. Implementation is parked for a dedicated day.**
Nothing here is decided except what §6 says. The owner has ideas for the WebView-side
problems in §4 — ask for them before you pick a route.

## 1. Terms

- **Matter:** the local smart-home standard (CSA). IP-based: Wi-Fi, Thread or Ethernet.
- **Controller:** the app that sends commands. Here, DeetsMusic.
- **Fabric:** one controller's private trust group. A light can be in about 5 fabrics at once.
- **Multi-admin:** a light that is in Apple Home (or Google, Alexa) joins a second fabric too.
- **Commissioning:** pairing. The controller proves the setup code, then gives the light an
  operational certificate for its fabric.
- **Process:** one running program in Task Manager. DeetsMusic is one app process today
  (plus the WebView2 helpers it always starts).

## 2. What on/off needs

- The **On/Off cluster** (0x0006): commands `On`, `Off`, `Toggle`; attribute `OnOff`.
  Subscribe to `OnOff`, so the panel shows a change made from a wall switch or Apple Home.
- All traffic is local: UDP over IPv6, port 5540, and mDNS (`_matter._tcp` for paired
  lights, `_matterc._udp` for lights in pairing mode). No cloud, no account, no key, no
  Apple-style call budget.
- **Pairing path: multi-admin, on the network.** The user picks "Turn on pairing mode" (the
  wording changes per app) in their home app and pastes the code into our panel. No
  Bluetooth. The light stays in Apple Home.
- A brand-new light that is in no app yet needs Bluetooth and Wi-Fi/Thread credentials.
  Recommendation: leave that out; the phone app does it better.

## 3. The three routes

| Route | Where the Matter code runs | Adds a process? |
|---|---|---|
| **Sidecar** | a separate Node program shipped next to the app (matter.js) | **Yes** — rejected |
| **Middle route** | the WebView side, in TypeScript. Rust only moves UDP packets and mDNS | No |
| **Native Rust** | the Rust side, a crate like `deets-airplay`, compiled into `deetsmusic.exe` | No |

The owner wants **one process** (2026-09-21). The sidecar is out.

### Cost (estimates, not measured — today's installer is 7.7 MB, `main.js` is 660 KB)

| Route | Installer | Memory | Code to write |
|---|---|---|---|
| Sidecar (Node + matter.js) | +30–40 MB | +40–60 MB | little |
| Middle route, **matter.js** | +1–1.5 MB | +15–30 MB | little; 3–6 MB of JS to parse |
| Middle route, **our own TypeScript** | +<100 KB | +1–3 MB | all of it + a thin Rust packet layer |
| **Native Rust** | +<1 MB | +a few MB | all of it, in Rust |

Measured input: npm unpacked sizes (0.17.9) — `@matter/model` 16 MB, `@matter/node` 15 MB,
`@matter/types` 13 MB, `@matter/protocol` 7.7 MB. Those include ESM + CJS builds, types and
maps. The weight is the full spec model as one object graph, which a bundler cannot trim;
we would use about 1% of it. **matter.js is ruled out on weight** in either form.

Our own TypeScript vs native Rust costs about the same. Size does not decide between them.

## 4. The WebView-side problems (middle route only)

1. **Hidden-window timers.** WebView2 throttles timers when the window is in the tray.
   MRP retries and session keep-alives would run late. Check with a timer test on a
   hidden window before choosing this route.
2. **Shared thread.** Pairing math (P-256, SPAKE2+) runs on the UI thread — tens of ms,
   once per light. Commands after that are cheap.
3. **Parse time** — matter.js only; a dynamic import behind the feature switch hides it.

The owner says all three are solvable (2026-09-21). His answers:

- **1 — timers: mostly not needed for a small on/off board (2026-09-21).** Design so no
  timer runs in the background: no standing subscription; read `OnOff` when the panel opens
  and subscribe only while it is open (window visible → no throttling); open a CASE session
  on the first click, not at start; send acks at once, not delayed. The one background case
  is a one-shot command (the sleep timer's "lights off"); 1 s clamped retries still fit
  inside the light's window. The timers in question: the ack timer (~200 ms), the MRP retry
  timer (~300 ms, backing off, ~5 tries) and the subscription liveness timer. WebView2 clamps
  hidden-page timers to 1/s, later ~1/min; a page that plays audio is exempt. Not measured.
- **2 — shared thread: an explicit turn-on sequence** when the user turns the feature on,
  plus a tip that the next start is delayed by X ms. Measure X on the next start and make
  it dynamic. During that time, pace the app's tile / card-generation motion to it; during
  turn-on, the relevant card or toggle plays its generation motion. Note: the heavy pairing
  math runs once per light at pairing; what runs at every start is CASE per light, so X
  grows with the light count — and with §4.1's on-demand sessions, start may cost nothing.
  Alternative (his fork): the crypto in a Web Worker, so the UI never waits.
- **3 — parse time:** moot, matter.js is ruled out.

## 5. What we already have (the AirPlay crate)

`deets-airplay` hand-rolls mDNS, RTSP, TLV8, SRP-6a, HKDF and ChaCha20-Poly1305.

| Matter needs | AirPlay has | New work |
|---|---|---|
| mDNS `_matter._tcp` / `_matterc._udp` | mDNS | new names, AAAA records |
| PASE (SPAKE2+ on P-256) | SRP-6a (also a PAKE) | SPAKE2+ with `p256` (Rust) or `@noble/curves` (TS) |
| HKDF / PBKDF2, SHA-256 | HKDF on `sha2` (SHA-512) | SHA-256 variant |
| AES-128-CCM | ChaCha20-Poly1305 | `aes` + `ccm` (Rust); WebCrypto AES + a small CCM (TS) |
| Matter TLV | TLV8 | richer format, same idea |
| CASE + our own root CA + one NOC per light | — | new: ECDSA, Matter TLV certs |
| MRP (ack + retry on UDP) | RTP over UDP | small retry loop |
| Invoke On/Off, Subscribe `OnOff` | — | a few message shapes |

**Rule either way:** the protocol runs off the UI path with a deadline on every network
call and no lock held across I/O (FRIENDS.md §8.11, the 0.12.0 freeze). An unreachable
light costs a stale switch, never a frozen window. Every command is async.

## 6. Recommendation and open forks

**Recommended: native Rust**, for the AirPlay reuse and no WebView workarounds. Our own
TypeScript is a fair second at the same cost if the §4 ideas hold. matter.js: no.

Open forks (he decides each one):
1. **Route:** native Rust or our own TypeScript.
2. **Attestation check:** verify the light's factory chain (DAC → PAI → PAA) against the
   Matter trust list (DCL), which means shipping and updating it — or skip it, as the test
   tools can. Skip is reasonable: the code comes from the user's own home app.
3. **Scope:** Wi-Fi lights only first, or Thread too.
4. **Panel:** where it lives, which lights show, Compass verbs, and whether the sleep timer
   can turn lights off.

5. **Delivery — built in, or the first add-on.** He expects more add-ons (2026-09-21).
   See §8.

## 8. Matter as the first add-on (idea, 2026-09-21)

| Shape | What ships | Main problem |
|---|---|---|
| A. Built in, off by default | same installer, a Settings switch | not an add-on |
| B. Downloaded Rust DLL | a signed `.dll` loaded at runtime | no stable Rust ABI: a narrow, versioned C interface |
| **C. Downloaded JS bundle** | UDP + mDNS stay in the app; the protocol is a signed JS file | downloaded code in the WebView (signature check) |
| D. Steam DLC | B or C through Steam | only if the app is sold on Steam |

**C in detail — no new worker.** The updater already has the shape (RELEASE.md §6.2): a
route on the `DeetsSupport` worker, files in R2, a signature the app checks with a key
built into every install. An add-on is the same: `addons/index.json` (id, version,
`apiVersion`, size, notes) + one `.js` and one `.sig` per version in R2.

- **Install:** download to the app data dir; Rust checks the Ed25519 signature
  (`ed25519-dalek` is already a dependency) with a built-in add-on key — a key of its own,
  not the updater's, so one leak does not open both.
- **Load:** Rust serves the checked file from disk on a custom scheme; the front end
  `import()`s it. The CSP allows that scheme and nothing remote.
- **Host API:** the add-on gets one versioned object — register a card or panel, Settings
  rows, Compass verbs, and a `net` part (UDP send/receive, mDNS browse) backed by generic
  async Rust commands. The app refuses an add-on whose `apiVersion` it does not know and
  offers its update.
- **Update / remove:** the add-on index is read with the app's own update check; remove =
  delete its folder.
- **Trust:** a JS add-on in the main page can do anything the page can (MusicKit, every
  Tauri command). Our own signed add-ons only is fine; third-party add-ons would need a
  sandbox (iframe + postMessage) — a later fork.
- **Paid add-ons** would need an entitlement check (DeetsAccounts) — a business fork.

C favours the TypeScript route (§3): the protocol becomes a JS file, no DLL. An extension
system is a load-bearing shared primitive; he expects more add-ons, which is what makes it
worth building.

## 7. Risks to measure on the day

1. **Thread lights** reach the PC through a border router (HomePod, Apple TV, Nest). The PC
   must accept the router's IPv6 Route Information Option (RFC 4191). Linux hosts often
   fail here. Windows is believed to accept it by default — not checked on this PC.
2. **Firewall prompt** on first bind of UDP 5540 / mDNS.
3. **Brand quirks** in pairing and certificates — only a real light shows them.

**First step on the day:** pair one real light and send one `Toggle`. That answers §7.1 and
§7.3 before any panel design.

## Sources

- matter.js — https://github.com/project-chip/matter.js/
- Creating a Matter controller with matter.js — https://tomasmcguinness.com/2025/07/20/creating-a-matter-controller-with-matter-js/
- Silicon Labs, multi-admin — https://docs.silabs.com/matter/2.5.2/matter-ecosystems/multicontroller-ecosystem
- rs-matter — https://github.com/project-chip/rs-matter
- matc — https://github.com/tom-code/rust-matc
- matter-rust — https://github.com/phunapps/matter-rust
- Thread IPv6 routing on a NAS — https://sergeytihon.com/2026/01/03/running-home-assistant-matter-server-on-a-ugreen-nas-a-deep-dive-into-thread-device-commissioning/
- Home Assistant, Thread — https://www.home-assistant.io/integrations/thread/
