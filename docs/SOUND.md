---
status: shipped
shipped_in: 0.8.0
desk_test: open
sources: [src/sound.ts, src/sound-dsp.ts, scripts/webview-eval.mjs, src/sleep.ts, src/sound-worklet.ts, src/sound-presets.ts]
updated: 2026-09-18
---
# DeetsMusic — sound processing: Advanced EQ + DeetsAdaptiveSound

> **Designed 2026-09-16. BUILT the same day: the graph + worklet (§1, §8.1 tests pass), the Sound panel
> (§2.3–2.4, §9), and phases 4 (the Windows output + volume) and 5 (Match loudness) — §10. Shipped in 0.8.0
> (2026-09-16); Match loudness off by default since 0.9.0 (§10). Open: §10.4 steps 4–10 and the
> user's report from daily listening (§11).** Decided so far (user, 2026-09-16): fork 0 = build, every
> effect **off by default**, and judge whether it is worth the risk (§7); fork 1 = the whole plan; fork 3 =
> hand-rolled worklet filters; fork 5 = a **title bar item with its own dropdown panel**, like the sleep timer (§2.3).
> Second round (same day): fork 2 = one DeetsAdaptiveSound switch with three parts; fork 4 = per-output EQ
> profiles, yes; fork 6 = −16 LUFS, library median for unmeasured songs, album gain for albums in order;
> fork 7 = app slider × Windows master; fork 8 = crossfeed automatic on headphones. **Requirement:** every
> decision is a setting, and the panel shows what each part is doing, why, and when it acts (§2.4).
> Measurements this rests on: [AUDIO-QUALITY.md](AUDIO-QUALITY.md) §4.3–4.4 and §0 below.

**Terms used here.**
- **Graph**: the Web Audio chain the song passes through before the speakers (`AudioContext`).
- **Biquad**: a second-order filter; one EQ band. Web Audio has one built in (`BiquadFilterNode`).
- **Worklet**: our own code on Web Audio's audio thread (`AudioWorkletProcessor`), in 128-sample blocks.
- **LUFS / LU**: loudness as the ear hears it (ITU-R BS.1770), in absolute units / differences.
- **Headroom**: how far the loudest sample sits below full scale (0 dBFS). A boost uses it up; past 0 the output clips.

## 0. Facts checked before this design

| Fact | How it was checked | Consequence |
|---|---|---|
| DRM audio passes through Web Audio. | Silent analyser on a Widevine stream at 256 kbps: peak 0.19, RMS 0.06 (AUDIO-QUALITY §4.4). | An in-app graph is possible. |
| `music.volume` acts **before** Web Audio. | Same song position, volume 1 → RMS 0.371 / 0.374; volume 0.25 → 0.093 / 0.093. Exactly ×0.25. | The loudness meter must undo the volume (or the volume moves into the graph). A boost after the volume cut cannot clip past what the cut removed. |
| MusicKit keeps a pool of up to 100 `<audio>` elements and takes one per player. | `musickit.js` v3: `fillAvailableElements` (100), `nextAvailableAudioElement` (`pop`). | More than one element can carry sound over a session. Each element is routed once, the first time it plays (a `createMediaElementSource` cannot be undone). |
| Chromium already resamples 44.1 → 48 kHz before Windows (−3.5 dB at 20 kHz). | `probe fidelity --listen`. | A graph at the device rate adds no new resample stage in theory; the probe must confirm that a flat graph measures the same. |
| **Apple's terms.** DPLA §3.3.6.D (MusicKit): "You may not, and You may not permit Your end users to, download, upload, or **modify any MusicKit Content** … You may play MusicKit Content **only as rendered by the MusicKit APIs or MusicKit JS**." | Read from developer.apple.com, 2026-09-16. | Every effect in this document changes the rendered audio. See §6 fork 0. |

Cost to Apple: **zero calls** for everything below.

## 1. The shared foundation — `src/sound.ts` (the graph)

Both features ride one graph. Nothing is routed while every effect is off: the element plays
straight to the speakers, exactly as today, at zero cost.

```
MusicKit <audio> (volume applied here, by MusicKit)
  │  per element, routed on its first play
  ├─ source ─ meter tap (loudness, §3A; divides out music.volume)
  │        └─ match gain (§3A) ───────────┐
  │                                        ▼
  │                              shared bus (one per context)
  │                                        │
  │           EQ: preamp → band 1 … band N (§2)
  │                                        │
  │           low-volume compensation: low shelf + high shelf (§3B)
  │                                        │
  │           crossfeed (§3C, stereo only)
  │                                        │
  │           limiter (worklet, lookahead, −1 dBTP ceiling)
  │                                        │
  └──────────── tap (AirPlay, AIRPLAY.md §12) ── sink gain ── destination (device, Chromium mixes → Windows)
                 (posts 16-bit chunks while armed)   (0 while a speaker plays alone)
  Since 2026-09-17 the context is created at 44.1 kHz, Apple's rate, so the tap hands the
  speaker the decode bit-exact; the local path measured identical either way (AIRPLAY.md §12.5 T1).
```

- **One `AudioContext`**, created on the first routed play, `latencyHint: "playback"` (bigger
  buffers: fewer dropouts, less CPU, and latency does not matter for music).
- **Bypass, not teardown.** Once an element is routed it stays routed. Turning every effect off
  sets each node flat/unity (a flat biquad, gain 1, crossfeed 0) or bypasses the chain in one step.
- **Silence is the failure mode.** A routed element is only heard through the graph. `sound.ts`
  watches `ctx.state` (`suspended` / `interrupted`) and resumes on the next play, a device change
  and focus; `diag.log("sound:ctx", …)` on every change. A resume that fails raises one toast
  (TOASTS.md §5) and un-routes new elements until relaunch.
- **AirPlay.** The capture records what the PC plays, so the HomePod gets every effect too. While
  AirPlay holds the slider, `music.volume` is pinned to 1 and the speaker holds the level; §3B
  reads the speaker volume then.
- **Sleep timer.** The wind-down stays on `music.volume` (before the graph); nothing changes.
- **Telemetry.** `diag.log` on route, arm/off of each effect, context state, per-song gain;
  `[perf] sound` (dev) with the worklet's block time; `probe fidelity --listen` with a flat graph
  must match AUDIO-QUALITY §4.3 before anything ships.
- **Test without sound.** `OfflineAudioContext` runs the same graph and worklets faster than real
  time with no device: the EQ's response, the meter against reference tones, the limiter — from
  `scripts/webview-eval.mjs`, silent.

## 2. Advanced EQ

### 2.1 The engine
- **Parametric bands**, each `{ on, type, freq, gain, q }`. Types: peak, low shelf, high shelf,
  high-pass, low-pass, notch. Up to 10 bands (more costs nothing but UI).
- **Graphic mode is a view, not a second engine:** 10 peak bands at octave centres
  (31 Hz … 16 kHz, Q ≈ 1.41) with one slider each.
- **Preamp** — see §2.1a.
- **The filters** — a fork (§6 fork 3):
  - *Native* `BiquadFilterNode`: C++ on the audio thread, no JS per sample. Its bell bands
    "cramp" near the Nyquist (a +6 dB bell at 16 kHz on a 48 kHz context comes out narrower and
    lower than asked).
  - *Hand-rolled* in a worklet: our own biquads with matched (Vicanek) coefficients, so a
    high-frequency band has the shape it was given; also allows 24/48 dB-per-octave cuts. JS per
    sample: 10 bands × 2 channels × 48 000 samples ≈ 1 M multiply-adds a second, well under 1 % of
    a core.
- **The curve**: the combined response drawn on a canvas (`getFrequencyResponse` for native, our
  own math for hand-rolled), with an optional live spectrum behind it (an `AnalyserNode`, drawn
  only while the editor is open; `dataset.frames` for frames.ts).

### 2.1a Preamp: four ways to keep a boost from clipping (user, 2026-09-16)
The first build always lowered the song by the curve's highest point ("Auto preamp"). On the desk,
with the HomePod playing, a bass lift made the whole song quieter: the bass came back to about where
it was and everything else dropped 4 dB. The fact that makes a choice worth having: `music.volume`
acts before the graph (§0), so on this PC at 14 % a song arrives 17 dB below full scale and a +4 dB
boost cannot clip; while a speaker holds the volume, MusicKit is pinned at 100 % and it can.

| `soundEqPreamp` | The song is lowered by | Trade |
|---|---|---|
| **limiter** (default, user's pick) | nothing | A boost sounds as drawn everywhere. At full scale (a speaker, or the app at 100 %) the −1 dBFS limiter works on peaks and a loud master can dip on bass hits. |
| needed | boost − the room the volume leaves (`headroomDb`, from `player.getAppliedGain`) | No lowering where there is room; safe where there is not. Near 100 % the last few % of the volume add less while a boost is on. |
| always | the curve's highest point | Never clips or pumps; a boost makes the rest quieter (the first build). |
| manual | `soundEqPreampDb` | A level set by hand; the limiter holds the rest. |

The fold's line says which mode is on and gives this moment's numbers (the boost, the room, the cut).

### 2.2 Presets and profiles
- **Built-in presets**: Flat, Bass lift, Vocal, Treble lift, Late night (fewer lows, softer
  highs). User presets: save / rename / delete.
- **Import**: a parametric text file in the Equalizer APO / AutoEq format (`Preamp: -6.1 dB`,
  `Filter 1: ON PK Fc 105 Hz Gain 4.5 dB Q 0.70`). This covers published headphone corrections
  without shipping anyone's measurement data. Export the same format.
- **Per-output profiles** — a fork (§6 fork 4): remember a preset per output (the Windows device,
  or the AirPlay speaker by name) and switch when the output changes. Needs Rust: the default
  device's name and form factor (`PKEY_AudioEndpoint_FormFactor`: speakers / headphones / headset)
  and a change notice (`IMMNotificationClient`), emitted to the front end.

### 2.3 Where it lives: the Sound item in the title bar (decided)
Modelled on the sleep timer (NEXT-VERSION §17, `src/sleep.ts`): an icon in the title bar next to
the clock, in every surface, with a dropdown panel that follows the menu mode. The panel is the
place to "go ham" on style, inside the token rules.

- **The icon:** three short EQ faders. Off: outlined, like the clock when unarmed. Any effect on:
  it takes the title color, and the faders sit at the active curve's shape (low / mid / high).
  Its hover hint names what is on: *Sound: Vocal EQ · Fuller at low volume*.
- **The panel, top to bottom** (each part through `enterRows` on open; `.pop` arrival;
  `dataset.frames = "sound"`):
  1. **Header:** *Sound* · a master On/Off pill · **Compare** (hold to hear it bypassed, §7).
  2. **The curve:** the combined response over 20 Hz–20 kHz on a log axis, a handle per band on
     the curve. Drag a handle = frequency and gain; wheel over it = Q; double-click = reset the
     band; right-click = type / off / delete. A faint live spectrum behind it while the panel is
     open. Graphic mode shows 10 vertical faders under the curve instead of handles.
  3. **Preset row:** ‹ Vocal › stepper, Save, and a menu (Rename · Delete · Import… · Export…),
     Parametric | Graphic pill, Auto preamp pill.
  4. **DeetsAdaptiveSound:** three rows — *Match loudness*, *Fuller at low volume* (Off · Gentle
     · Full), *Headphone crossfeed* (Off · Light · Medium · Strong) — each with a one-line status
     (*This song: −3.2 dB* · *At 14 %: +5 dB bass* · *Headphones: on*).
  5. **Meter line:** the limiter's reduction and the output peak, only while something is on.
- **Small surfaces:** the curve shrinks to the panel width (min 300 px) and the band handles keep
  their hit size (`--sound-handle-hit`); in Mini the preset row wraps under the curve.
- **Tokens:** `--sound-*` in skin.css (panel width, curve height, handle size and hit area, grid,
  motion), curve / fill / grid / handle colors as theme roles in themes.css; each skin may restyle
  the curve (Press: ink line; Ocean: a glow; Glass: a lit edge; Cyber: a scanline trace).
- **Agent + keys:** `soundOn`, `eqPreset`, `eqMode`, `adaptLoudness`, `adaptLowVolume`,
  `adaptCrossfeed` as settings keys with specs; the bands themselves are not an agent value in v1.

### 2.4 Insight: every decision visible and configurable (user requirement)
Each part in the panel has three layers: a **status line** (what it does to this song, now), a
**hint** on the row (the rule, one sentence), and a **How it decides** fold (the inputs, live, and
the settings that change the rule). Nothing acts without a line in the panel saying so.

**The Settings column is now in two places (2026-09-18).** Nine of those rows — Avoid distortion,
Lower the song by, Remember each output, Match songs to, Keep albums together, Songs not measured
get, Follow the volume of, Blend amount and Ask to keep after — are ALSO rows of
**Settings › Sound**. The panel keeps every one of them, unchanged. They were taken out of the
panel for a few hours that day and put back: a person who opens this panel for the first time
must be able to finish here. Both controls write the same store key and both repaint from
`onSettingsChange`, so there is no second copy of the state and nothing to synchronise.

| Part | Status line (examples) | How it decides (fold) | Settings |
|---|---|---|---|
| EQ + profiles | *Headphones (WH-1000XM4) · Vocal · preamp −4.5 dB* | Current output and its form factor; the preset remembered for it; *Switches when Windows changes the default output, or AirPlay connects*; the list of known outputs → preset (editable). | `eqPerOutput` On/Off; per-output map; Auto preamp |
| Match loudness | *This song: −9.8 LUFS → −6.2 dB* · *Not measured yet: library median −4.1 dB (212 songs)* · *Album gain: −5.0 dB (8 of 11 measured)* | *Measures while a song plays; counts after 80 % heard without a skip*; target; album rule (*an album, or its songs in album order*); unmeasured rule; the limiter's share. | `loudTarget` −18 / −16 / −14 LUFS; `loudAlbum` On/Off; `loudUnmeasured` Median / None; Forget measurements (action) |
| Fuller at low volume | *App 14 % × Windows 60 % = −21 dB → +6.5 dB bass, +1.5 dB treble* | *Updates when either volume changes*; the reference (100 % × 100 % = no change); the curve (ISO 226) as a small plot of boost vs level. | `lowVolStrength` Off / Gentle / Full; `lowVolKey` App × Windows / App only |
| Headphone crossfeed | *Headphones detected → on (Medium)* · *Speakers → off* | The output's form factor as Windows reports it; *Turns on for headphones and headsets*. | `crossfeedMode` Auto / Always / Off; `crossfeedLevel` Light / Medium / Strong |
| Evaluation (§7) | *On since Sep 16 · review on Sep 23* | What to listen for; the Compare button; the measured checks (clean / CPU / dropouts) with their latest results. | `soundReviewAfter` 3 / 7 / 14 days / Never; on that day one toast: *Keep Sound effects? Review in the Sound panel.* |

All of these are store keys with defaults and agent specs (SETTINGS.md §5); the fold's live inputs
come from `sound.ts` state, not a second computation.

### 2.4a The layout after the first look (user, 2026-09-16)
"Crowded and overwhelming" → **two tabs**. Head: *Sound* · [Equalizer | Adaptive] · **i** · Compare.
One view at a time; a footer line under both.
- **Equalizer tab:** Equalizer [Reset] [On] · the graph with the sliders · the zones · one line
  "20 Hz · ▪ This song · ┄ What you hear · 20 kHz" · ‹ preset › [Sliders | Dots] [⋯] · the status
  line (and a note with **Undo** after Reset) · How the equalizer decides.
- **Adaptive tab:** Adaptive sound [On] · three parts, each its label over its status, pill at right ·
  How adaptive sound decides.
- **Footer:** "Asks to keep on Sep 23 · Limiter idle" with the 7 days pill; Keep / Turn all off
  appear under it when the review is due.
- **Sliders are the default** (`soundEqMode: "graphic"`, user: easier to read than dots). A store
  that held the old default and never turned an effect on is moved to Sliders once. The sliders
  show any curve, fitted to ten bands; the first drag turns the preset into those ten bands.
- **Reset** (user: next to On/Off): back to Flat; saved presets and Custom are untouched, so Undo
  is one pick. Disabled while Flat.
- **The i button** wears `.panel__action` (the skin's own square icon button) with a stroked info glyph.

**Second look (user, 2026-09-16).**
- **Undo replaces Reset in place** (same slot, one width: `--sound-reset-w`) for 8 s; another pick ends it.
- The head's controls (tabs, i, Compare) share one height (`--icon-lg`).
- The panel wears the app's scrollbar (`app-scroll`); the rule for every future scroller is now in
  CLAUDE.md's build checklist and UI-ARCHITECTURE §Scrollbars.
- **Equalizer off shows Flat.** Turning it on brings the picked preset back; ‹ › while off steps from
  Flat and turns it on; a slider moved while off starts Custom from flat and turns it on.
- **The output follows AirPlay:** while a speaker plays, the panel names it and per-output profiles
  key on `airplay:<name>` (airplay.ts → `sound.setOutput`). Windows' own device waits for phase 4.
- **The limiter readout is a box** (`--sound-meter-w`) updated twice a second with the worst values of
  that half second, so it reads instead of flickering.

**Third look (user, 2026-09-16).**
- Footer: the limiter box at left, **Keep: [7 days]** at right, the pill's text centred at one width
  (`--sound-foot-pill-w`). "Asks whether to keep the effects on Sep 23" is the pill's hover hint,
  no longer a line of its own.
- `scrollbar-gutter: stable` on the panel: the bar's width is reserved, so nothing shifts when it appears.
- The volume controls count as inside the panel (`alsoInside`: `#vol`, `.np__vol`; a hover-mode
  leave onto them is vetoed), so turning the volume while listening keeps the panel open.
- Both "How … decides" folds: the settings first, then the explanation, each paragraph in its own
  box. The Preamp level row always shows (dimmed unless Set by hand), so nothing below it jumps.
- The sleep panel stayed open over a just-opened Sound panel: a dropdown primitive bug (a trigger's
  click stops propagation, so other panels never saw a click away). Fixed in `dropdown.ts` for every
  menu; UI-ARCHITECTURE §dropdown.

**Fourth look (user, 2026-09-16).**
- In midi the panel's left edge passed the window's left edge ("Sound" read "nd"): the 300 px panel
  hangs left from the icon, and midi puts the icon about 290 px from the left. `keepInWindow`
  (`dropdown.ts`) now moves the panel right until it keeps `--panel-edge-gap` clear of the edge, on
  open and on a resize while open. It reads layout (the icon's right edge − the panel's width), not
  the panel's rect, so the `.pop` scale does not skew it.
- "A couple of clicks to open": the log showed a `pointerdown chrome-right` (the gap between icons)
  and a `pointerdown drag-region` (just left of the icon, which starts a window move) before the
  click that opened it. The Sound and sleep icons now take clicks in a larger empty box around the
  16 px glyph (`--title-hit-x` = half the row gap, `--title-hit-y`). A warm open measured 13 ms;
  the first open after launch had one 115 ms long task (the panel's first layout), once per launch.
- Gentle ran into its pill's right edge: the pill shrank in its row. Pills no longer shrink, and the
  Adaptive column's pills share one width (`--sound-part-pill-w`), text centred.
- Status lines and the folds' help text sit in boxes (`growBox`): a ResizeObserver sets the box's
  height from its text and `--sound-grow` eases it, so a line that wraps to more lines slides the
  rows below instead of jumping them. Fold paragraphs are reused, not rebuilt on each refresh, and
  text is written only when it changed. Reduced motion: no ease.

**Fifth look (user, 2026-09-16): beginner words, a pill that stays put.**
- A part's pill sits on its label's line; the status box is under both at full width, so the pill
  never slides when the box grows.
- Plain words everywhere a listener reads: "Fuller" is defined in the fold (the ear hears deep and
  high sounds less when music is quiet; this part adds bass around 100 Hz and a little treble around
  10 kHz back). Status lines say what happens ("This song is turned down 6.2 dB", "Adds +2.5 dB bass
  and +0.6 dB treble", "On: Headphones is headphones", "Off: Windows does not say whether … is
  headphones. Pick Always to use it"). LUFS stays only in the target pill's hint.
- Row names are verb-first: Avoid distortion (was Preamp; By hand was Set by hand), Lower the song
  by, Remember each output, Match songs to (Standard / Louder / Quieter), Keep albums together, Songs
  not measured yet (Usual amount / No change), Clear measurements, Follow the volume of (App +
  Windows / App only), Blend amount. Store values are unchanged; agent labels follow (AGENT.md).
- Bug fixed: the remembered-outputs list showed a Windows endpoint id for an output not playing.
  `soundOutputNames` keeps each output's name when its preset is remembered.

### 2.5 Seeing the song: shape, zones, the reading (user's picks, 2026-09-16)
For a listener who has never heard of EQ, the graph shows the music, not only a curve.

- **This song** — a filled silhouette: the song's own spectrum, read **before any effect** (every
  element node also feeds a `pre` sum with an analyser), averaged over the song in 96 log bands at
  10 looks a second, silence skipped, reset when the song changes. Drawn against a 4.5 dB/octave
  slope (most mixes fall about that much), so a balanced song looks level, not sliding right.
- **What you hear** — a dashed outline: the same shape plus the EQ curve and Fuller at low volume's
  shelves (computed, so it moves with a drag at once). Hidden while it equals the song.
- **Zones** — Bass · Body · Voice · Detail · Air under the graph (Hz only at the ends). Hover: what
  lives there and what raising or lowering it does. **Hold: hear only that range** (a 24 dB/oct
  band-pass after everything, faded over 20 ms; works with every effect off).
- **The reading** — behind the **i** button in the head (user: hover text or an info button, so
  power users are not talked down to). Hover: *This song is heavy in the bass and soft in the top
  end.* Click: the sentence, a bar and a dB value per zone (each against the song's own average),
  and how it was measured. A zone ±3 dB or more stands out.
- **Routing (fork):** opening the panel routes the playing element through the graph even with every
  effect off (a bit-exact passthrough), so the shape can be read. That element stays routed after
  the panel closes; nothing new is routed unless an effect is on.
- **Cost:** one analyser read and 96 band sums every 100 ms, only while the panel is open. No Apple calls.

## 3. DeetsAdaptiveSound

One switch, three parts. Each part adapts to one thing and has its own on/off (and strength):

| Part | Adapts to | What it does |
|---|---|---|
| A. Match loudness | the song | Each song plays at the same perceived loudness. |
| B. Fuller at low volume | the volume | Bass and treble rise as the volume goes down, the way the ear loses them. |
| C. Headphone crossfeed | the output | Mixes a little of each channel into the other on headphones, so hard-panned mixes tire less. |

### 3A. Match loudness
- **The meter** (hand-rolled worklet, BS.1770-4): K-weighting (a high shelf +4 dB at ~1.7 kHz and
  a high-pass at ~38 Hz, coefficients computed for the context rate), mean square in 400 ms blocks
  with 75 % overlap, gates at −70 LUFS absolute and −10 LU relative → integrated loudness. Also
  the sample peak. It reads the **element's** signal and divides out `music.volume` (§0).
- **When a measurement counts:** at least 80 % of the song heard without a seek past a gap.
  Otherwise it is thrown away and the song is measured on a later play.
- **Storage:** a Rust SQLite table `loudness(song_id, lufs, peak, heard_fraction, measured_at)` —
  a schema migration (the `migration:` log line). One write per song end.
- **Applying it:** gain = target − song LUFS, with the peak kept under the limiter's ceiling by
  capping the gain (or letting the limiter take ≤ 2 dB). The gain moves in a 50 ms ramp at the
  song change (no click), on the element's own gain node, so a preloaded next song on another
  element never changes the playing one.
- **Forks (§6 fork 6):** the target (−16 LUFS, like Apple's Sound Check; or −14, like most
  streaming); album mode (an album played in order uses the album's average, so quiet tracks stay
  quiet); a song never measured (no change / the library's median gain / a slow live estimate
  over its first 10 s).
- Cost: the meter is a few operations per sample (well under 1 % of a core); one row per song.

### 3B. Fuller at low volume
- **The curve:** ISO 226 equal-loudness contours. At a lower listening level the ear needs more
  bass (and some top) for the same balance. Gains from the volume in dB against a reference
  (100 % volume = no change, assumed 80 phon).
- **The shelves (rebuilt 2026-09-18, found in review).** The first build used one low shelf at
  100 Hz set to the ISO value at 100 Hz. An RBJ shelf's corner is its **half-gain** point, so it
  delivered 2.6 dB at 100 Hz where ISO asked 5.3, and 4.9 dB at 50 Hz where ISO asked 7.0 (at a
  17 dB drop). ISO's bass side is a slope, about 0.8 dB per octave from 400 Hz down, not a step.
  Now **two low shelves** fit it to within 0.4 dB RMS over 31.5–400 Hz at every drop from 12 to
  30 dB (fit run against `isoCompensation`): 300 Hz carrying 0.8 × the 100 Hz value, and 70 Hz
  carrying 0.5 × the 31.5 Hz value; their sum is the deep-bass plateau. One high shelf at 10 kHz
  as before. Constants in `sound-dsp.ts` (`LOW_SHELF_HZ`, `SUB_SHELF_HZ`, `HIGH_SHELF_HZ`); the
  worklet, the panel's curve and the panel's status line all read them.
- **The level it keys on** — fork 7 decided: the app slider × the Windows master volume (Rust
  reads `IAudioEndpointVolume` and its change notice); while AirPlay holds the slider, the
  speaker volume. **Plus the match gain (2026-09-18):** with Match loudness on, a song matched
  7 dB down is 7 dB quieter at the ear whatever the slider says, so `volumeDropDb` subtracts
  `matchDb` and `setMatchGain` re-pushes the bus. Before, raising the slider to undo the match
  gain shrank the shelves while the loudness at the ear had not changed.
- **Strength**: Off / Gentle / Full (a scale on the shelf gains). Full, the response of the chain:

  | Drop | Plateau (≤ 31.5 Hz) | 50 Hz | 100 Hz | ISO at 31.5 / 50 / 100 | 16 kHz |
  |---|---|---|---|---|---|
  | −6 dB | +2.9 | +2.6 | +1.8 | 2.8 / 2.5 / 1.9 | +0.4 |
  | −17 dB (14 %) | +8.1 | +7.4 | +5.0 | 8.0 / 7.0 / 5.3 | +1.2 |
  | −24 dB | +11.3 | +10.3 | +7.0 | 11.3 / 9.9 / 7.4 | +1.6 |
  | −40 dB | +11.7 (capped) | +10.7 | +7.2 | 18.5 / 16.1 / 11.9 | +2.5 |

  Gentle = half (−17 dB: +4.0 / +3.7 / +2.5). The bass plateau is capped at 12 dB and at the
  drop itself; both bass shelves scale together so the shape holds.
- **Clipping:** none possible from this part at low volume — the boost sits after a larger cut
  (§0). Near 100 % it adds nothing.
- Cost: two biquads whose gains change only when the volume changes (a ramp, not per sample).

### 3C. Headphone crossfeed
- **The filter** (Bauer, as in bs2b): each channel → low-pass ~700 Hz (its own ~0.23 ms group delay is the
  interaural delay; an added delay line dipped mono 3.4 dB at 1 kHz in the offline test) → into the
  other channel at −4.5 to −9.5 dB; the direct channel gets a small high shelf so the total stays
  flat. Levels as presets: Light (650 Hz, −9.5 dB), Medium (700 Hz, −6 dB), Strong (700 Hz,
  −4.5 dB). Built from native nodes (splitter, biquad, delay, gain, merger) or in the EQ worklet.
- **"Adaptive"** — a fork (§6 fork 8): on only when the output's form factor is headphones /
  headset (needs the Rust device notice of §2.2), or a plain on/off.
- Mono or AirPlay speaker output: off by definition.

## 4. Build order (the whole plan, decided)

| Phase | What | Proves |
|---|---|---|
| 0 | Fork 0 (terms). A flat graph + `probe fidelity --listen`: same numbers as AUDIO-QUALITY §4.3. Context-loss recovery. | Routing costs no quality and never goes silent. |
| 1 | `sound.ts` foundation + limiter + diag + offline tests. | The chain, bypass, recovery. |
| 2 | 3B Fuller at low volume. | Smallest part, the change most audible at your 14 % volume. |
| 3 | Advanced EQ engine + editor + presets + import. | The big UI piece. |
| 4 | Rust output-device notice → per-output profiles (2.2) + 3C crossfeed. | Device awareness. |
| 5 | 3A Match loudness (worklet meter, schema migration). | The most code. |

## 5. What is not in scope
- Bit-perfect / exclusive-mode output: blocked until a virtual output device exists (AIRPLAY.md §10, item 4).
- Room correction with a microphone.
- Linear-phase EQ (latency and pre-ringing for no audible gain on music).
- Spatial / surround upmixing.

## 6. Forks (all decided 2026-09-16)

0. ~~Apple's terms~~ — **decided:** build, every effect off by default; §7 judges if it is worth the risk.
1. ~~Scope~~ — **decided:** the whole plan (§4).
2. ~~Name and grouping~~ — **decided:** one DeetsAdaptiveSound switch, three parts.
3. ~~EQ filters~~ — **decided:** hand-rolled worklet biquads (matched coefficients, steeper cuts). One
   worklet hosts the EQ, the shelves, crossfeed, the meter and the limiter.
4. ~~Per-output EQ profiles~~ — **decided:** yes, configurable, with the insight of §2.4.
5. ~~EQ UI~~ — **decided:** a title bar item with a dropdown panel (§2.3).
6. ~~Match loudness~~ — **decided:** −16 LUFS (setting), album gain on (setting), library median for unmeasured (setting). **2026-09-18 (user):** the default target is −14, and Match loudness is on by default inside Adaptive sound (§10.2).
7. ~~Low-volume key~~ — **decided:** app slider × Windows master (setting).
8. ~~Crossfeed~~ — **decided:** automatic on headphones (setting: Auto / Always / Off).

## 7. Is it worth the risk? (the evaluation, decided with fork 0)

Every effect ships off. Before the feature leaves the dev branch, it has to earn its place:
1. **It measures clean.** A flat chain equals AUDIO-QUALITY §4.3 in `probe fidelity --listen`; a
   known EQ curve shows its exact gains in the level column; the meter reads EBU Tech 3341 test
   tones within ±0.1 LU (OfflineAudioContext, silent).
2. **You can hear it.** **Compare** in the panel: hold to bypass the whole chain, level-matched
   (the bypass applies the same average gain), so louder never passes for better.
3. **It stays out of the way.** `heaviness-sample.ps1` with the chain on and off shows no change
   in CPU or memory that matters; no dropout in a long session (`sound:ctx` lines).
4. **Your call after living with it** for some days: keep, keep some parts, or remove.

## 8. Verified math (2026-09-16, `src/sound-dsp.ts`, run with Node against the sources)

| Check | Result |
|---|---|
| K-weighting at 48 kHz vs the BS.1770-4 table | equal to 15 digits (both stages) |
| ISO 226:2003 self-check: SPL at 1 kHz for 20 / 40 / 80 phon | 20.005 / 40.010 / 80.012 |
| Integrated loudness of a 1 kHz sine, −23 dBFS, stereo (EBU Tech 3341 case 1) | −22.99 LUFS (−23.0 ± 0.1) |
| Butterworth low-pass 12 / 24 / 48 dB/oct | −3.01 dB at fc; −12.4 / −24.3 / −48.5 dB at 2 fc |
| Bell error against the analog shape, 20 Hz–20 kHz (RBJ → matched) | 1 kHz +6 dB: 0.02 → 0.01; 8 kHz +6: 0.85 → 0.15; 12 kHz +6: 2.34 → 0.53; 16 kHz +6 Q2: 2.98 → 0.45; 16 kHz −9: 4.87 → 0.88; 19 kHz +4: 1.87 → 0.43 dB. Centre gain exact, all stable. |

### 8.1 The worklet itself — `__sound.offlineTest()` (dev, silent, OfflineAudioContext at 48 kHz)

| Test | Result (2026-09-16) |
|---|---|
| Every effect off (passthrough) / enabled but flat | bit-exact after the limiter's 71-sample delay (max error 0) |
| EQ (+6 dB 1 kHz, −6 dB 12 kHz, +4 dB low shelf 120 Hz), tone gains vs the design | 60 Hz 3.781 / 1 kHz 5.969 / 3 kHz 0.468 / 12 kHz −5.961 / 16 kHz −3.436 dB — equal to `chainDb` to 3 decimals |
| Limiter, +6 dBFS sine in | output peak −1.000 dBFS (the ceiling) |
| Crossfeed −4.5 dB, mono in, at 100 Hz / 1 kHz / 10 kHz | 0.000 / 0.000 / 0.000 dB (first build had a delay line: −3.4 dB at 1 kHz; removed) |
| Fuller at low volume, −17 dB drop, full strength | 2026-09-16 (one shelf): +4.94 dB at 50 Hz, 0 at 1 kHz, +1.17 dB at 16 kHz. **Since 2026-09-18 (two low shelves, §3B) the test renders 31.5 / 50 / 100 Hz too; expected +8.1 / +7.4 / +5.0 dB — re-run `__sound.offlineTest()` and record it here.** |
| Element meter, 1 kHz −23 dBFS stereo, 12 s | −22.99 LUFS |
| Listen to a zone (Body, 150–500 Hz), effects off | 300 Hz −0.09 dB; 60 Hz −31.8 dB; 3 kHz −62.7 dB |

## 9. What the panel build holds (2026-09-16) and the desk test

**Files.** `src/sound-dsp.ts` (math), `src/sound-worklet.ts` (audio thread), `src/sound.ts` (graph,
settings → config, review), `src/sound-presets.ts` (built-ins, graphic fit, APO text),
`src/sound-panel.ts` (the panel), markup in `index.html` (`#sound`, left of the sleep clock), the
`.sound__*` block in `styles.css`, `--sound-*` in `skin.css` (base + a look for Press, Ocean,
Glass and Cyber), `--eq-*` roles in `themes.css`. Keys: `sound*` in `settings-store.ts`
(all effects off), the Sound section in `agent-settings.ts` (the two switches off only),
Settings › Reset › Sound (not saved presets). Ledgers: ONBOARDING.md (hints), TOASTS.md §5
(review, resume failed). Log lines: `sound:context`, `sound:ctx`, `sound:route`, `sound:on` /
`sound:off`, `sound:preset`, `sound:bandAdd`, `sound:presetSaved`, `sound:compare`,
`sound:output`, `sound:reviewDue`, `sound:resumed` / `sound:resumeFailed`.

**What the panel said it could not do yet** (at the panel build, before phases 4 and 5 in §10
built these parts). Match loudness: "Not built yet". Crossfeed on Auto:
"The output type is not known yet" (Always works). Fuller at low volume on App × Windows:
"Windows not read yet" (it counts Windows as 100 % until phase 4).

**Desk test (dev app).**
1. The title bar shows three faders left of the clock, grey. Hover: *Everything is off*.
2. Open the panel: the parts slide in. Equalizer Off, the Flat preset, Adaptive sound Off.
3. Play a song. Click the curve near 100 Hz, above the line: a dot appears, the curve lifts,
   Equalizer turns On, the icon turns the title color and its low knob rises. The log has
   `sound:context`, `sound:route`. You hear more bass.
4. Drag the dot: the curve follows with no clicks in the sound. Wheel on it: the bell widens or
   narrows. Double-click: back to 0 dB. The band row shows the shape, frequency, gain and Q.
5. Hold Compare: the effect goes away at about the same loudness; release: it comes back.
6. ‹ › walks the presets; Vocal and Late night change the sound at once. Graphic: ten faders
   that reproduce the curve; drag one.
7. ⋯ › Save as "Test" → the name shows; Rename; Delete (twice). Copy, then Paste: an imported
   copy appears (RBJ filters, the fold says so).
8. Adaptive sound On, Fuller at low volume Gentle: the status line reads the app volume and the
   bass/treble boost; move the volume pill and the numbers follow.
9. Crossfeed Always: on headphones the stereo image narrows a little.
10. Open "How the equalizer decides" and "How adaptive sound decides": the lines match the settings.
11. Turn both switches off: the icon goes grey; the sound is as before (the element stays routed
    through a passthrough — bit-exact in §8.1).
12. Every skin: Press (ink line, dashed grid), Ocean (glow), Glass (lit edge), Cyber (scope).
13. **Song shape.** Everything off, a song playing: open the panel. Within a second a grey silhouette
    grows under the curve and settles; the log has `sound:inspect` and `sound:route`. The sound does
    not change. Next song: the shape starts over.
14. Turn on Bass lift: a dashed "What you hear" outline rises over the silhouette's left side.
15. Hover each zone label: the hint says what lives there. Hold Voice: only the middle is heard;
    release: the full song comes back with no click.
16. Hover **i**: one sentence about the song. Click it: five bars with dB values and the method.
17. **Layout.** The head shows Sound · [Equalizer | Adaptive] · i · Compare on one line (it wraps in a
    narrow window). Each tab shows only its own parts; switching slides them in.
18. Sliders are the view on first open. Pick Vocal: the sliders sit at the fitted curve; drag one:
    the preset becomes Custom with ten bands. Dots: the dot view; back to Sliders.
19. Reset: the curve goes flat, a note says "Reset to flat." with Undo; Undo brings Vocal back.
20. The i square looks like the card header buttons in each skin.
21. **Fits the window.** In midi, open the panel: its left edge sits a little inside the window, and
    "Sound" and Compare show in full. Drag the window narrower to mini with the panel open: it stays
    inside. In max it still hangs from the icon.

## 10. Phases 4 and 5: the output and Match loudness (built 2026-09-16, shipped in 0.8.0)

**Scope (user question).** Every effect acts only on DeetsMusic's own audio: the graph is inside the
app's WebView, between MusicKit's `<audio>` and the app's output stream. Other apps, system sounds
and browsers are not changed. An AirPlay speaker hears the effects, because the capture records
this process after the graph (§1).

### 10.1 Phase 4 — `src-tauri/src/audio_out.rs`
- One thread (`audio-out`) holds the COM objects. Windows calls two notice objects
  (`IMMNotificationClient`: the default output changed, or its name or form factor;
  `IAudioEndpointVolumeCallback`: its volume moved). A notice only sends on a channel; the thread
  waits 40 ms to fold a burst (a volume drag) into one read, reads, and emits `audio-output`
  `{ key: "win:<endpoint id>", name, kind, volume, volumeDb, muted }` when anything changed.
  `audio_output` returns the last read for a front end that loads later. **No polling.**
- Form factor → kind: Headphones → headphones; Headset, Handset → headset; Speakers, line level,
  digital passthrough, S/PDIF, a display (HDMI) → speakers; the rest → unknown.
- `sound.ts` keeps the Windows output and the AirPlay speaker apart. The speaker wins while it plays;
  the Windows output returns when it lets go (`setAirplayOutput`). Per-output presets key on
  `win:<id>` or `airplay:<name>`.
- Fuller at low volume, on App × Windows, uses the **Windows attenuation in dB**
  (`GetMasterVolumeLevel`), not the slider's 0–1 position (the slider is a taper). While AirPlay
  plays, the Windows volume does not count (the capture is taken before it).
- Log: `audio-out: <name> (<kind>)` once per output change (not per volume move); `sound:output`.
- **Limit:** the default output for the console role. An output set for one app in the Windows
  "App volume and device preferences" page is not followed.
- First launch (2026-09-16 16:26): `audio-out: Headphones (High Definition Audio Device) (headphones)`.

### 10.2 Phase 5 — `src/sound-loudness.ts` + `src-tauri/src/loudness.rs`
- **Measure.** While Adaptive sound is on, each element worklet sends a 100 ms hop (K-weighted mean
  square + sample peak, before the match gain). The module divides MusicKit's volume back out
  (`getAppliedGain` squared; hops at less than −40 dB of volume, and exact-zero hops from a paused
  element, are skipped), makes 400 ms blocks with 75 % overlap, and at the next song start gates
  them into integrated loudness (`integratedLufs`). The listen counts when at least 80 % was heard
  (forward progress ticks under 2 s) with **no jump forward**; then one row is saved.
- **Store.** Schema v7: `loudness(song_id PK, lufs, peak_db, heard, measured_at)`; a later full
  listen replaces the row. All rows load once at launch into a map (`sound:measurements`).
- **Apply, at each song start** (`stats.onListen`: the same start the play log counts):
  1. album gain — the queue context is `album:<albumKey>` of this song and shuffle is off: the
     energy of the album's measured songs, weighted by length. *Album gain: −5.0 dB (8 of 11
     measured)*; the total is the library's songs with that album key;
  2. the song's own loudness — *This song: −9.8 LUFS → −6.2 dB*;
  3. the library median gain (setting) — *Not measured yet: library median −4.1 dB (212 songs)*;
  4. no change.
  The gain is clamped to ±12 dB and capped so the peak sits at most 2 dB over the limiter's ceiling
  (the line then says *held from …*). It ramps in 50 ms on every element node (one plays at a time).
  The line ends with the state of the song's own measurement: *Measured.* when the song already
  has a row, or *Measuring: 42 %.* when it does not. Every listen measures the song again and
  replaces the row, but the line speaks about the number the gain comes from, so a song heard
  before never reads "Measuring" again (fix, 2026-09-17: it said "Measuring" on every play, on
  a frozen percentage, which read as a measurement that never ends). The percentage now counts
  up: `renderLoudStatus()` in sound-panel.ts runs on every `onPlayerProgress` tick while the
  panel is open, and `setText` drops the write on the ticks that do not change the sentence.
- **Repeat one and the listen (reviewed 2026-09-17, left as it is).** A repeat-one lap has no
  item change, so `player.ts` reads the lap from the clock: a tick in the last 1.5 s, then a tick
  under 1 s. That lap is what ends the listen and saves the row. Widening the 1.5 s window was
  considered and **rejected**: `playbackTimeDidChange` fires about once a second, so the last tick
  is already inside the window, and a false lap opens a second Last.fm scrobble window for a song
  that was already scrobbled — the cost lands outside the app. If a lap is ever seen to be missed,
  measure it first: three laps must give three `player:repeatLoop` lines, two `sound:measured`
  lines, and a `sound:match` of `kind:"song"` from lap 2 on.
- **Reversed 2026-09-18 (user):** Match loudness is **on** by default inside Adaptive sound, and
  the target is **−14**. The review found the owner's install with Match on had changed 3 of 106
  song starts (unmeasured songs set to No change), and that at −16 a library of −8 to −10 LUFS
  masters is a 6–8 dB cut on nearly everything. The paragraph below is the record of the day
  before.
- **Measure by default (user's call 2026-09-17, option A).** Match loudness is **off** by default
  inside Adaptive sound, but songs are measured whenever Adaptive sound is on, so the gains are ready
  when Match loudness is turned on. `sound.ts` has two flags: `measure` (= Adaptive on: the element
  meters run, and Adaptive on counts as "wanted", so songs are routed even with every part off) and
  `match` (= Adaptive on AND Match loudness on: the gain is applied). With Match loudness off the
  row reads *Off. Songs are measured as you listen, so they are ready when you turn it on (N so
  far).* Rejected: B, measure with Sound fully off (routes every play for every user; breaks "every
  effect ships off"; the lost-start watch has no data yet).
- **Forget** (How adaptive sound decides › Measurements) deletes every row.
- Log: `sound:measureOn` / `sound:measureOff` (the meters), `sound:matchOn` / `sound:matchOff`, `sound:match {kind, gainDb}` per song,
  `sound:measured {lufs, peakDb, heard, blocks}`, `sound:measureForget`, `loudness: forgot N`,
  `migration: v7 added the loudness table`.

### 10.3 Performance

| Part | Cost | When |
|---|---|---|
| Output watcher | one sleeping thread; one read per notice | always (Windows wakes it) |
| Volume notices | at most one emit per 40 ms during a drag; one config message to the bus | while the Windows volume moves |
| Element meter | 2 biquads × 2 channels + a sum per sample (well under 0.1 % of a core) | Adaptive sound on |
| Meter hops | 10 small messages a second; a 4-minute song keeps about 2,400 numbers | Adaptive sound on, playing |
| Album gain | one pass over the library's tracks (about 4,000) per song start | Album gain on, an album in order |
| SQLite | one row per fully heard song; one read of all rows at launch | — |

The larger, older cost: while any effect (Match loudness included) is on, audio runs through the
Web Audio graph and the bus worklet (EQ, limiter) the whole time it plays. The §7.3 heaviness check
(`heaviness-sample.ps1`, on against off) is still to be run.

### 10.4 Desk test (needs a runner restart: Rust changed)
**Status (user, 2026-09-16):** steps 1–3 PASS on the desk. Steps 4–10 are tested when the release is
live (§11). Phase 0 (a flat graph measures like no graph) PASSES: AUDIO-QUALITY §4.3a.
1. Launch. The log has `migration: v7 added the loudness table` (once) and
   `audio-out: <your output> (<kind>)`.
2. Sound › Equalizer › How the equalizer decides: *Output: <name>; Windows reports <kind>.*
3. Change the Windows default output (the taskbar's sound flyout). A new `audio-out:` line; the panel
   names the new output; with Per output on, the preset remembered for it comes back.
4. Adaptive sound On, Crossfeed Auto: on headphones the line reads *<name>: headphones → on*; on
   speakers *→ off*.
5. Fuller at low volume: the line reads *App 14 % × Windows 60 % (−9.6 dB) = …*. Move the Windows
   volume: the numbers follow at once. Connect AirPlay: the line reads *Speaker …*.
5a. (2026-09-17) Adaptive sound On, Match loudness Off (the default). The row reads *Off. Songs are
   measured as you listen … (N so far)*. Let a new song play out: `sound:measured` in the log, N + 1.
6. Match loudness On. Play a song not heard before: *New song: left as it is until it is measured.*
   with *Measuring: N %.* Watch the number for 20 s **with the panel open**: it must rise on its
   own (fix 2026-09-17). Let it play out. The next song logs `sound:measured` with a LUFS value
   (most pop masters: −6 to −10).
7. Play the same song again: *This song is turned down 7.9 dB. Measured.* — the word "Measuring"
   and the percentage are gone (fix 2026-09-17), and a loud master is clearly quieter.
8. Seek forward in a song: at the next song, no `sound:measured` line for it.
9. Play an album from the Library card (not shuffled) with two songs measured: *Album gain: … (2 of N
   measured)*. Shuffle on: the song's own line.
10. Forget: the count in the fold goes to 0; the log has `loudness: forgot N`.

### 10.5 Watching for a lost start (built 2026-09-16; check it next build session)
**Why.** The first of two flat-route probe runs (AUDIO-QUALITY §4.3a) lost its first tone through a
freshly routed element; the second run was clean. The cause is not proven. Two watchers now run
whenever audio is routed, so a real listen can catch it.

**1. The start watch** (`sound.ts` `watchStart`, the element worklet's `watch` / `alive` / `first`).
At each `play()` of a routed element: the play time and the element's clock. The node reports its
first block ever (`alive`) and the first input sample above −80 dBFS after the play (`first`).
- Dev: every start writes `[perf] sound start {heard, fresh, mediaMs, wallMs, aliveMs, ctx, src}`.
  `fresh` = routed by this play; `mediaMs` = how far the element's clock moved before sound reached
  the graph (a song's own opening silence counts too); `aliveMs` = a new node's time to its first block.
- Release and dev: `sound:startLost` (WARN, to the log file) when no sound arrives in 5 s while
  playing, or a fresh route waited over 750 ms, or any start over 2.5 s, or a new node took over 150 ms.

**2. The clock watch** (`watchClock`). Chromium's dropout counter (`AudioContext.playoutStats`) is not
in this WebView (Edge 153). Every 5 s while routed audio plays, the output timestamp's audio clock is
compared with the wall clock; a stall or dropout makes the audio clock fall behind. Over 20 ms:
`sound:clockSlip {slipMs, overMs, routed}` (WARN, file) and `[perf] sound clockSlip` in dev.

**Cost.** One sample scan per block only between a play and its first sound; one `alive` message per
node; one `getOutputTimestamp` call every 5 s while playing.

**First check (2026-09-16 17:16, dev):** a quiet test tone with 200 ms of leading silence →
`fresh: true, mediaMs: 203, aliveMs: 3` (the node ran within 3 ms; the 203 ms is the tone's own lead).

**Next build session, read it:**
```bash
grep -h "sound:startLost\|sound:clockSlip\|\[perf\] sound start" "$APPDATA/com.deetsmusic.dev/deetsmusic.log" "$APPDATA/com.deetsmusic.app/deetsmusic.log" | tail -40
```
No `startLost` / `clockSlip` lines over some days of listening = the probe's lost tone was a
test-setup artefact. Lines = the pattern in their fields (fresh routes only? a context state? a
long `aliveMs`?) points at the fix.

## 11. After it goes live: the user's own test (open, 2026-09-16)

All development on Sound is done for now (committed 2026-09-16; live since 0.8.0, 2026-09-16). The
next step is the user's, not a build:
1. Use it in daily listening for some days, on headphones and on
   speakers (and AirPlay).
2. Get a feel for each part: the Equalizer and its presets, Compare, Match loudness, Fuller at low
   volume (Gentle and Full), Headphone crossfeed (Auto), and the panel's words and help text.
3. Report back: what sounds better, what sounds worse or odd, what is confusing, what is never used.

That report is §7 step 4 (keep, keep some parts, or remove). The §10.4 desk test and the §7.3
heaviness check (`heaviness-sample.ps1`, effects on against off) go with it. No new Sound work
starts before the report.

