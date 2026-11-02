---
status: idea
desk_test: none
sources: [src-tauri/src/airplay.rs, src/sound-worklet.ts, src-tauri/src/bridge.rs, docs/integrations/AIRPLAY.md, docs/integrations/ROOMS.md, docs/integrations/AGENT.md]
updated: 2026-11-01
---
# DeetsPod: a pocket device for your music, with the PC at home as the player

**An idea (2026-11-01), talked through with him in one sitting.** Nothing is built, nothing is
decided but what §1 lists. The rest of this doc is Claude's proposal from that talk, and every
part of it can shift as the hardware, the firmware and the terms teach us more. Read §1 as the
fixed points and everything after it as a draft.

**Terms used here.** *The puck*: a small ESP32-S3 device with a round screen (he owns two, §2).
*The home PC*: a Windows machine at home running DeetsMusic, signed in. *The relay*: a server
that carries bytes between the two when they are not on the same network. *The tap*: the worklet
in the page that copies the decoded sound into a ring in Rust, built for AirPlay
([AIRPLAY.md](../integrations/AIRPLAY.md) §12). *The bridge*: the app's local HTTP routes that
the CLI and the MCP already use ([AGENT.md](../integrations/AGENT.md)).

---

## 1. What he said (non-negotiable; everything else is a proposal)

In his words, from the talk of 2026-11-01:

- He wants **a DeetsPod style device for music on the go**: "a dedicated device with no ads and a
  clean and straightforward experience".
- He bought **two boards to develop on**: the Waveshare ESP32-S3-Knob-Touch-LCD-1.8 and the
  Waveshare ESP32-S3-Touch-AMOLED-1.75C (§2). He is "happy to get in the mud and mess with the
  dev puck to get this working".
- **Leaving a machine running at home is a viable approach**: "if the user has an old laptop,
  windows machine, or a mac mini or something".
- He asked for **our own encryption on both ends**, the puck and the app. He asked; the design in
  §5 is Claude's answer and is open.
- He wants the approach to serve **both the knob and the puck** (§8).
- He asked how the puck connects: must it be on a wireless connection, can Bluetooth carry it,
  what would not strain the user's phone (§9).

Everything below this line is Claude's proposal.

## 2. The two boards

| | ESP32-S3-Knob-Touch-LCD-1.8 (SKU 31623) | ESP32-S3-Touch-AMOLED-1.75C (SKU 33691) |
|---|---|---|
| Price | $45.99 | $41.99 (on backorder 2026-11-01) |
| Chips | ESP32-S3R8 (8 MB PSRAM, 16 MB flash) **plus** a classic ESP32-U4WDH (Bluetooth Classic, 4 MB flash) | ESP32-S3R8 (8 MB PSRAM, 32 MB flash) |
| Screen | 1.8" IPS 360×360, ST77916, QSPI | 1.75" AMOLED 466×466, CO5300, QSPI |
| Touch | CST816 | CST9217 |
| Input | rotary knob (one encoder per chip), DRV2605 haptic motor | two buttons, QMI8658 6-axis motion sensor |
| Audio | PCM5100A stereo DAC, **3.5 mm jack**, mic; no speaker | ES8311 codec, ES7210 echo cancel, two mics, **speaker pads**; no jack |
| Storage | TF card slot | none |
| Power | charger, optional 800 mAh cell | AXP2101 power chip, optional cell |
| Radio | 2.4 GHz Wi-Fi; BLE 5 on the S3; Bluetooth Classic on the second chip | 2.4 GHz Wi-Fi; BLE 5 only |
| Case | CNC metal, 242 g | CNC aluminium, 104 g, lanyard hole |

Links: [the knob](https://www.waveshare.com/esp32-s3-knob-touch-lcd-1.8.htm?sku=31623) ·
[the AMOLED puck](https://www.waveshare.com/esp32-s3-touch-amoled-1.75c.htm?sku=33691).

**What the hardware allows.** A frame is 260 KB (knob) or 434 KB (AMOLED); double buffering fits in
PSRAM; expect 20–30 fps on full redraws over QSPI. A cover, the title, a progress ring, buttons and a
scrolling list are easy; the skins' animation is not. Opus decode at 128 kbps is a few percent of
one core; the crypto of §5 is a rounding error; a 2 s jitter buffer is ~350 KB. Streaming keeps the
radio awake, so figure 3–4 h on a small cell with the screen on. The knob is the earbuds puck (jack,
card slot); the AMOLED is the speaker puck (pads, better screen).

### 2.1 Other boards and suppliers (a survey, 2026-11-01; his ask: "the pucks were the first things I found")

**Dev pieces, the round-screen ESP32-S3 field.**
| Board | Screen | Chip | Audio | Notes | Price |
|---|---|---|---|---|---|
| **LILYGO T-Encoder-Pro** | 2.04" AMOLED 390×390 (CO5300 on the newer run), touch | S3R8, 16 MB / 8 MB | buzzer, haptic motor; **no DAC** | A knob with the largest round AMOLED; two Qwiic (I2C) ports; few spare GPIO, so an I2S DAC needs checking | ~$40–50 |
| **M5Stack Dial v1.1** | 1.28" IPS 240×240, touch | S3FN8, **no PSRAM** | buzzer | The most finished knob product (case, RFID, RTC, 6–36 V in, ESPHome); too little memory for our stream and UI | ~$30 |
| **Waveshare ESP32-S3-Touch-LCD-1.28 / 1.85 / 2.1** | round IPS 240×240 up to 480×480 | S3R8 | some have a speaker header | Cheap bare boards; the 2.1" has 480×480 | $18–35 |
| **Espressif ESP32-S3-BOX-3** | 2.4" square | S3R8 | **speaker, two mics, codec** | The official dev kit for a voice/audio device; square; the reference for the audio pipeline | ~$50 |
| The two he owns (§2) | 360×360 IPS knob · 466×466 AMOLED | S3R8 | DAC + jack · codec + speaker pads | Still the best pair for this project's dev: real audio out on both | $42–46 |

**The next class: ESP32-P4.** Waveshare's **ESP32-P4-WIFI6-Touch-LCD-3.4C** (3.4" round IPS
800×800, 10-point touch, optically bonded glass) and **-4C** (4" 720×720): a dual-core RISC-V at
400 MHz, 32 MB PSRAM, MIPI-DSI and CSI, hardware JPEG and H.264, USB 2.0 high-speed, SDIO TF,
dual mics with echo cancel, a speaker header, Wi-Fi 6 and BLE through an onboard ESP32-C6.
This is the product-grade MCU for a UI like ours: fast enough for the skins' motion, hardware
JPEG for covers, room for everything. Round AMOLED P4 boards do not exist yet. **It still cannot
run a DRM client** (no Widevine build for 32-bit RISC-V), so §3 holds for it too. ~$60–80.

**LTE dev boards (for C4).** Beside Waveshare's (§9.1): **LILYGO T-SIM7670G-S3** (S3 + SIM7670G
Cat-1 + GNSS, 18650 holder, solar input; the Standard variant adds Qwiic) and the **T-A7670**
family (adds voice and SMS; LILYGO says pick the SIM7670G when neither is needed). ~$45–60.

**A standalone product needs a different class of chip.** The only puck that plays Apple Music by
itself runs a DRM client. Two exist outside Apple's own hardware; **he does not want the Android
one if it can be avoided (2026-11-01)**, so the Linux one is the route:

- **Linux on ARM + Widevine (the route).** Google ships the Widevine client for ARM Linux, and
  Raspberry Pi distributes it as a package of Raspberry Pi OS (`libwidevinecdm0`, with Google's
  permission); Chromium on a Pi plays music.apple.com, Spotify and Netflix with it. On other ARM
  boards (Radxa Zero 3W, Orange Pi, Rockchip RK3566/RK3568, Allwinner) the same binary is used by
  extracting it from ChromeOS images, which works but is not a licensed distribution: **fine for
  his own device, not for a product**. So the product-grade Linux puck is Raspberry Pi silicon:
  the Zero 2 W (512 MB, tight for Chromium but it runs a one-tab kiosk), the Compute Module 4 or 5
  (1–8 GB, a carrier board of our own). The app itself reaches it through the Linux port's chosen
  shell, castLabs ECS (LinuxPort.md), whose Linux arm64 builds carry Widevine (**to verify**); until
  then a Chromium kiosk on music.apple.com, or the web demo's shell with MusicKit JS, is the player.
- **Android + MusicKit for Android** (Widevine L3 plus Apple's public Android SDK) is the other,
  set aside at his word. Kept here as a record only.

**A pocket Pi, in parts (a sketch).** Pi Zero 2 W ($15) · Pimoroni **HyperPixel 2.1 Round**
(480×480 round touch over DPI, ~$40; it takes the whole GPIO header, so audio goes out over USB:
a $10 USB-C DAC dongle, or Bluetooth to earbuds from the Pi's own radio) · PiSugar 3 battery
board (1,200 mAh, ~$40) · card and case ($15). About $120, roughly 2.5–3 h on that cell at the
Zero 2 W's 300–500 mA under Chromium, a 20–30 s boot, a warm case. A CM5 build is faster and
hungrier. Ten times the ESP32's power is the honest shape of this puck; the ESP32 pucks stay as
its knob and remote. A standalone Pi puck also means no home PC at all.

**The Compute Module (2026-11-01; the Zero 2 W was out of stock everywhere he looked).** A Pi
with no connectors: the SoC, RAM, optional eMMC and optional Wi-Fi/BT on a 55 × 40 mm card with two
100-pin high-density connectors underneath. Everything else (power, USB, display, audio) lives on a
**carrier board**, which is what makes it the product part: our carrier is the puck's shape.

| | CM4 | CM5 |
|---|---|---|
| SoC | BCM2711, 4× Cortex-A72 at 1.5 GHz (the Pi 4) | BCM2712, 4× Cortex-A76 at 2.4 GHz (the Pi 5) |
| RAM | 1 / 2 / 4 / 8 GB | 2 / 4 / 8 / 16 GB |
| Storage | Lite (TF on the carrier) or 8–32 GB eMMC | Lite or 16–64 GB eMMC |
| Wireless | optional, antenna on-module or a U.FL for an external one | the same |
| Display | 2× DSI, 2× HDMI | 2× DSI (shared with CSI), 2× HDMI |
| Power, playing in Chromium | ~3–4 W whole system | ~5–7 W, wants a heatsink |
| Price | ~$30 (Lite 1 GB wireless) to ~$90 | ~$45 (Lite 2 GB wireless) to ~$95 |
| Guaranteed in production | until January 2034 | until 2036 |
| Connector | 2× 100-pin Hirose DF40 | the same footprint; most CM4 carriers work with a few caveats (PCIe, power) |

**For the pocket puck, the CM4 Lite with wireless is the fit**: lighter on power, cheaper, in stock,
and Chromium with Widevine at 2 GB is comfortable. The CM5 is for a desk or bag device with a fan-
less heatsink, or if the UI ever wants the headroom. Both run the same Raspberry Pi OS with the
licensed Widevine package.

**Dev carriers, off the shelf.** The official CM4 IO Board (~$35; every port, full size) or
Waveshare's smaller CM4 carriers (CM4-IO-BASE-A/B, CM4-NANO class, $20–35); for CM5 the official
CM5 IO Board (~$20) or Waveshare's CM5 carriers. A round screen over **DSI**, which leaves the GPIO
header free for an I2S DAC: Waveshare's 2.1" and 2.8" round DSI touch displays (480 × 480, ~$40–45)
plug into the carrier's 22-pin DSI connector and work with a Pi OS overlay. So a dev stack is CM4
Lite 2 GB wireless ($35) + a Waveshare carrier ($25) + the 2.1" round DSI ($40) + an I2S DAC hat or a
USB DAC ($10–20) + a card: about $115, then a battery board. **Or skip the CM for dev:** a Pi 4
Model B 2 GB ($45, in stock) takes the same DSI display and DAC and runs the same software; move to
the CM when the custom carrier is drawn.

**Battery.** At ~4 W a 3,000 mAh LiPo (11 Wh) is about 2.7 h; 5,000 mAh (18.5 Wh) about 4.5 h, a
phone-sized cell. The carrier needs a charger plus a 5 V boost able to deliver 3 A bursts
(BQ25895-class charger and a boost, or a PiSugar-style board for dev). The CM4 wants a clean 5 V;
brown-outs show as throttling first.

**Our carrier, when it comes.** A round or squircle board the puck's size: the two DF40 connectors,
the DSI flex to the round panel, an I2S DAC with a headphone amp and a jack (the PCM5102A plus a
small amp, or a codec), the charger and boost, a TF slot (Lite module), USB-C for charging and
boot, the encoder or buttons, a haptic driver. The CM4's design files and a KiCad reference carrier
are public from Raspberry Pi, which is most of the work.

**Prices as found 2026-11-01 (Pi prices rose with the memory shortage; the Zero 2 W is gone).**
| Part | Price | Where | Note |
|---|---|---|---|
| CM4 Lite 1 GB, **no wireless** | $45 | SparkFun, in stock | The one he found. No Wi-Fi: a standalone puck would need an $8 USB Wi-Fi dongle, a USB port and ~0.3 W |
| **CM4 Lite 2 GB wireless** (CM4102000) | $55–62.50 | Newark 76 in stock at $62.50; DFRobot $62.50 (2 per customer); PiShop; SparkFun $55 out of stock | The fit for the pocket puck |
| CM5 Lite 2 GB wireless (CM5102000) | $70–80 | DigiKey $70.88 in stock; PiShop $72.50 | Faster, hungrier |
| Pi 4 Model B 2 GB | ~$45–50 | widely in stock | **No carrier needed**: the dev shortcut, same OS and screens |

**Screens and enclosures: what gets a Pi to "ready to go" (his ask; he is not attached to a round screen).**
Nothing Pi-based is as ready as a $45 ESP32 puck out of the box, except two handhelds that take a
CM4 Lite; everything else is a stack plus a printed case until our own carrier exists.

| Route | What you get | Price (without the module) | Fit |
|---|---|---|---|
| **Retroflag GPi Case 2 (CM4)** | A Game Boy shell: 3" 640×480 IPS, 4,000 mAh, USB-C charging, speaker, d-pad and buttons, no touch. Insert a CM4 Lite, flash, play | ~$70 | The cheapest ready-made pocket Linux player; buttons as transport; a "DeetsBoy", kitsch but complete |
| **Clockwork uConsole (CM4 kit)** | 5" 1280×720, full keyboard, aluminium shell, 2× 18650, speaker, **an optional 4G module** (C4 for free) | ~$195 with core; a no-core kit exists, supply spotty | The most capable ready-made device; keyboard-heavy for a music puck |
| **Seeed reTerminal** | CM4 4 GB / 32 GB built in, 5" 1280×720 touch, a case, buttons; **no battery** | ~$195 | A desk or wall DeetsPod, ready |
| **Pi 4 + Pimoroni HyperPixel 4.0 Square** | 4" 720×720 square touch (72 × 72 mm, 254 ppi) over DPI; dozens of printable cases | ~$70 screen | The square is the AMOLED puck's aspect at eight times the pixels; DPI takes the GPIO header, so audio goes over a USB DAC or Bluetooth |
| **Pi 4 / CM4 + a Waveshare DSI display** (2.8" to 5", some sold with a matching case) | DSI leaves the GPIO free for an I2S DAC hat | $30–60 | The flexible stack; chunky with a battery hat |
| **Pi 4/5 + official Touch Display 2 (7", 720×1280) + official case** | ready kit, mains powered | ~$130 all in | A kitchen or desk DeetsPod, not a pocket one |
| **Battery for a stack** | PiJuice HAT (~$65, a real UPS with a cell), Waveshare UPS HAT with 18650s (~$30), Geekworm X120x for the Pi 5 | | Adds 15–25 mm of thickness |

**Claude's reading, open.** For dev: a Pi 4 Model B 2 GB, the HyperPixel 4.0 Square, a $10 USB DAC
and a printed case, powered from a bank on the bench (~$170), with a CM4 Lite 2 GB wireless from
Newark on the shelf for the carrier work. For a ready pocket device today: the GPi Case 2 with a
CM4 Lite. For "par with the puck" in earnest: our own carrier and case (above); nothing bought
off the shelf reaches it.

Links: [SparkFun CM4 Lite](https://www.sparkfun.com/raspberry-pi-compute-module-4-lite.html) ·
[Newark CM4102000](https://www.newark.com/raspberry-pi/cm4102000/rpi-compute-module-4-lite-2gb/dp/86AH2093) ·
[GPi Case 2](https://thepihut.com/collections/latest-raspberry-pi-products/products/gpi-case-2) ·
[uConsole CM4 kit](https://clockworkpi.com/product-page/uconsole-kit-rpi-cm4-lite) ·
[HyperPixel 4.0 Square](https://thepihut.com/products/hyperpixel-4-0-square-hi-res-display-for-raspberry-pi).

**Starting a product line (a sketch, every step his).**
1. **Now:** firmware on the two boards he owns (§7, §8). Nothing to buy.
2. **10–50 units:** off-the-shelf boards, our firmware, a printed or small-run CNC case, sold as a
   DIY kit or flashed. Waveshare, LILYGO, M5Stack, Seeed, Elecrow and Makerfabs all take OEM runs
   of their own boards (a logo, a case colour, pre-flashed firmware) at a few hundred units.
3. **100–1,000 units:** a custom PCB around a **pre-certified module** (ESP32-S3-WROOM or an ESP32-P4
   module; the LTE module likewise), the round panel bought from the display vendor (the 1.75"
   CO5300 AMOLEDs are a stock Shenzhen part), PCBA by JLCPCB, PCBWay or Seeed Fusion, a case by
   CNC (~$15–30 a unit at 100) or injection (tooling $3–8k, then ~$2 a unit). A pre-certified radio
   module keeps the FCC test to Part 15B unintentional-radiator (~$2–5k) instead of a full
   intentional-radiator campaign; CE the same way; UN38.3 for shipping a battery. **LTE changes
   this:** carrier acceptance of an end device (PTCRB and the carriers' own programmes) is
   expensive, which is why §9.1's IMEI check matters at 10 units and a certification budget at
   1,000.
4. **Suppliers to talk to first:** Waveshare and LILYGO (the boards he has, both do custom runs),
   M5Stack (the Dial is proof they ship a finished knob product), Seeed Studio (Fusion PCBA plus an
   ODM desk), Elecrow (CrowPanel line plus ODM), Makerfabs (ESP32 display boards, custom work).

Links: [T-Encoder-Pro wiki](https://wiki.lilygo.cc/products/t-encoder-series/t-encoder-pro/) ·
[M5Stack Dial v1.1](https://shop.m5stack.com/products/m5stack-dial-v1-1) ·
[Waveshare ESP32-P4 3.4C](https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-3.4c.htm) ·
[LILYGO T-SIM7670G-S3](https://wiki.lilygo.cc/products/t-sim-series/t-sim7670g-s3/) ·
[ESP32 display boards compared (atomic14)](https://www.atomic14.com/esp32/boards/displays/) ·
[ESP32 cellular boards compared](https://microcontrollerslab.com/?p=47423).

### 2.2 Our own case and carrier: a v1 at or near $100 (his target, 2026-11-01)

**His words:** "Would like v1 of this to try to remain under or as close to a 100 as possible (puck
seems very enticing for its price)." Everything below is Claude's proposal against that number.

**The number drives the chip.** A CM4 Lite 2 GB wireless is $62.50 on its own today (§2.1), so a
CM4 puck cannot land near $100 until Pi prices fall. The only Pi that does is the **Zero 2 W at
$15**, out of stock everywhere this week because of the memory shortage, but a stock-tracker
(rpilocator) catches the restocks. It is also the better pocket chip by power (1.5–2.5 W whole
system, two to three times the CM4's battery life). Its limit is 512 MB of RAM: a one-tab Chromium
kiosk runs; the castLabs ECS shell will not. **So on the Zero 2 W, DeetsMusic is its web shell in
Chromium** (the real UI in a browser already exists for the demo and the rooms, WEB-DEMO.md,
WebRooms.md) **with MusicKit JS, and Chromium's Widevine does the DRM.** No ECS needed on this
device. The Zero 2 W needs no carrier: it is the board, with a DSI panel on its flex and two small
modules beside it.

**Fork V1 — the compute (open; his call).**
| | Option | v1 cost | Trade |
|---|---|---|---|
| **V1a (recommended for the $100 v1)** | **Pi Zero 2 W**, no carrier | ~$75–90 all in (table below) | Wait for stock; 512 MB → Chromium web shell only; 4.5–6 h on 3,000 mAh |
| V1b | CM4 Lite 2 GB wireless + our carrier | ~$120–130 one-off; ~$105–115 at 100 units | The product path from day one; the carrier is ours to design; 2.5–3 h on the same cell |
| V1c | CM4 Lite 1 GB wireless (CM4101000), if found | ~$10–15 less than V1b | Rarely stocked; 1 GB is enough for the kiosk |
| V1d | **Pi 3 Model A+**, $25–27.50 | ~$85–100 all in | The Zero 2 W's cores at 1.4 GHz, 512 MB, dual-band Wi-Fi, a full DSI port and the 40-pin header; 65 × 56 mm; ~2–3 W. **Checked 2026-11-01: not reliably in stock** (SparkFun $27.50 shows both "in stock" and "backorder", Adafruit and PiShop out, DigiKey zero with no backorders and "Not For New Designs", The Pi Hut £24 in stock in the UK). Its Broadcom SoC is discontinued (Raspberry Pi's docs; the CM3 on the same chip reached end of life 2025-10-16), so it is a bench stand-in at best, never a product part |

**His rule (2026-11-01): the board must be smaller than the screen, for the product look.** The
footprints, so the fork below can be read against it:
| Board | Size | Fits behind 4" square (72 × 72) | Fits behind 4" round (Ø ~100) |
|---|---|---|---|
| Pi Zero 2 W | 65 × 30 mm | yes, 3.5 mm to spare each side | yes |
| CM4 / CM5 | 55 × 40 mm | yes | yes |
| Pi 3 Model A+ | 65 × 56 mm | yes, tight (3.5 mm / 8 mm) | yes (86 mm diagonal) |
| Pi 4 B / Pi 5 | 85 × 56 mm | **no** | **no** |
| Radxa Zero 3W / Orange Pi Zero 2W | 65 × 30 mm | yes | yes |
The 3.5" DSI panels (~56 × 92 mm portrait, ~71 × 53 mm landscape active) also hide the Zero 2 W
and the 3A+, and the CM4. Below 3.5" nothing Pi-sized fits: the 2.1"–2.8" class is 53–71 mm
across, under the Zero's 65 mm length and the CM4's 68 mm diagonal. **3.5" is the floor** for a
Pi-based puck that obeys the rule.

**Fork V2 — the screen (open; his call; "doesn't have to be round", 2026-11-01).** The Pi cannot
drive the pucks' QSPI AMOLEDs, so the 1.75"–1.8" class is out. **Corrections (2026-11-01, from
the vendor pages):** Waveshare's 2.1" round is not a DSI part; **Waveshare sells no square DSI
display at all**; its round DSI displays are the 3.4" 800 × 800 and the 4" 720 × 720 at $60–90,
not the $45 first written here. The one square 720 × 720 for a Pi is Pimoroni's HyperPixel 4.0
Square, which is **DPI** (the 40-pin header), not DSI.
| | Option | Interface | Price | Quality, as the vendor states it | Trade |
|---|---|---|---|---|---|
| **V2a** | **Pimoroni HyperPixel 4.0 Square**, 4" 720 × 720 IPS, capacitive touch | DPI, 40-pin header | ~$70 (The Pi Hut £66; RobotShop $69) | IPS, 254 ppi, 60 fps; brightness not stated; a bare glass-front module, no toughened cover | 72 × 72 mm; fits every 40-pin Pi (Zero 2 W, 3A+, 4); **takes the GPIO**, leaves I2C only → audio over a USB DAC or Bluetooth; Pi 5 / Bookworm support to check |
| V2b | **Waveshare 3.5" DSI (H)**, 480 × 800 IPS, 5-point touch | DSI | **$38** | IPS, 170°, toughened 6H glass; bonding not stated; brightness not stated; 96 g | Portrait phone shape (~56 × 92 mm outline, to confirm from the drawing); the Zero and the 3A+ hide behind it; the Midi surface fits it; leaves the GPIO free for an I2S DAC and amp |
| V2c | **Waveshare 3.5" DSI (E)**, 640 × 480 IPS, 5-point touch | DSI | **$33** | as V2b | 4:3 landscape, ~71 × 53 mm active; the cheapest Pi screen that passes the size rule |
| V2d | Waveshare 3.4" / 4" round DSI, 800 × 800 / 720 × 720 IPS, 10-point touch | DSI | $60–90 by listing | IPS, 170°, **optically bonded toughened 6H glass**, software brightness; 188 g; brightness not stated | The best-built panel of the set and the round look; the price breaks the $100 v1 |
Every Waveshare DSI page says "driver required" (a Pi OS overlay from their wiki) and lists the
Pi 4 / 3B+ / 3A+ / CM4 outright; the Zero 2 W works through the 22-pin adapter flex they include
or sell. Brightness is unstated on all of them; this class of 4" IPS is typically 300–400 nits,
fine indoors, weak in sun. None is an AMOLED; the pucks' blacks are not on offer for a Pi.

Claude's lean, open: **V2b** for a $100 v1 that keeps I2S audio and a proper DAC; **V2a** when the
square look matters more than a wired DAC. (The earlier bill assumed a $40–45 square DSI that
does not exist; the bill below is corrected.)

**Fork V3 — the case (open; his call).**
| | Option | v1 cost | Trade |
|---|---|---|---|
| **V3a (recommended for v1)** | **3D printed**: PETG at home, or MJF nylon / resin from JLC3DP or Craftcloud | $5–20 | Product-grade finish in MJF; no radio problem; a bezel and a glass or acrylic lens glued on gives the puck's "glass front" |
| V3b | CNC aluminium (JLCCNC, PCBWay) | $30–60 one-off, $15–25 at 100 | The pucks' feel; **metal blocks Wi-Fi**, so a plastic ring or the glass front must carry the antenna, as the pucks do |
| V3c | Injection moulding | $3–8k tooling, then $1–3 a unit at 500+ | Not v1 |
| V3d | Hybrid: printed body, machined bezel ring | $20–40 | Metal where the hand touches, plastic where the radio is |

**The V1a bill (Zero 2 W + 3.5" DSI, printed), one-off, corrected 2026-11-01.**
| Part | Price |
|---|---|
| Pi Zero 2 W | $15 |
| Waveshare 3.5" DSI (H) 480 × 800 touch ($38), or the 3.5" (E) 640 × 480 ($33), with the Zero's 22-pin flex | $33–38 |
| Power: an IP5306 power-bank module (charge + 2 A boost, $2–3) and a 3,000 mAh LiPo ($8) | $11 |
| Audio: PCM5102A I2S DAC module with a 3.5 mm jack ($4); a MAX98357 I2S amp ($3) if a speaker | $4–7 |
| Printed case, buttons or a small encoder, a lens | $8–15 |
| 16 GB card | $6 |
| **Total** | **$77–92** (with the HyperPixel Square in place of the 3.5": $109–124; with a 3A+ in place of the Zero: +$10–12) |
About 4.5–6 h of play on that cell; a 20–30 s boot; earbuds at line level (loud enough, not a
headphone amp; a $3 amp chip fixes it on the carrier later). The IP5306 is a power-bank chip, so
v1 has no clean-shutdown signal; a $1 supervisor or the Zero's own GPIO poll covers it. A proper
charger plus fuel gauge (BQ25895 + MAX17048) is the carrier's job in V1b.

**The V1b bill (CM4 2 GB wireless + our carrier), one-off.** Module $62.50 · carrier prototypes
(five boards assembled at JLCPCB, our KiCad from Pi's published CM4IO reference) ~$40 a board at
qty 5, ~$15–20 at 100 · bare 4" or 2.1" DSI panel $15–25 · LiPo $8 · case $10–20 · card $6 →
**$140–160 one-off, ~$105–115 at 100 units.** Over the target until the module price drops; the
carrier work is the same one the product needs, so none of it is wasted.

**What our carrier holds (V1b, and the product).** The two DF40 connectors · the DSI flex · an I2S
DAC with a headphone amp and a jack (PCM5102A + a small amp, or a codec) · a MAX98357 for a speaker
if wanted · BQ25895 charger with a 5 V 3 A boost and a MAX17048 fuel gauge · a TF slot (Lite) ·
USB-C for charge and boot · encoder or buttons · a DRV2605 haptic · a 2.4 GHz antenna window if
the case is metal. Round or square to the panel's outline, ~8 mm thick plus the cell.

**Boards outside Raspberry Pi, for the record.** The Radxa Zero 3W (Rockchip RK3566, 1–8 GB,
Wi-Fi 6, the Zero's 65 × 30 footprint) and the Orange Pi Zero 2W (Allwinner H618, 1–4 GB) are
in and out of stock at $25–60 now that prices rose. Both run Chromium with Widevine only through
the extracted ChromeOS binary (§2.1): fine on his bench, not for a product. The Radxa's 2–4 GB
would run the castLabs shell where the Zero 2 W cannot, which is the one reason to keep it in view.

**The case, since he will learn to model it (2026-11-01).** Parametric CAD in a browser: Onshape
(free for public documents) or Fusion 360 (free personal licence). Code-first, which suits a
developer: build123d or CadQuery in Python, or OpenSCAD; the case becomes a script with the
panel's and the board's dimensions as variables, and a new board is a changed number. Raspberry
Pi publishes STEP models of every board, Waveshare gives 2D drawings of each display, and KiCad
exports the carrier as STEP, so the fit is checked in the model before a print. Print the first
bodies in PETG at home; order the one to show in MJF nylon.

**The honest comparison with the ESP32 puck.** The $45 puck is finished hardware that cannot play
Apple Music by itself (§3); the $80–90 Zero 2 W build is a kit we assemble that can. The two
designs are not rivals: the ESP32 puck is the remote and the far speaker of the home PC design
(§4), the Pi puck is the standalone one, and the same web shell and the same relay serve both.

## 3. Why the puck cannot play Apple Music on its own (settled)

Apple Music is FairPlay. The decryption runs only inside Apple's clients: Apple's operating
systems, Safari, MusicKit for Android (closed, ARM), and partners' devices (Sonos, Echo, smart
TVs) under Apple agreements. On Windows and Linux, Chrome plays music.apple.com through
**Widevine**, a closed Google binary for x86 and ARM Linux, Android and ChromeOS, which needs an
OS, a browser with EME and hundreds of MB of RAM. The ESP32-S3 is an Xtensa core with 8 MB of
PSRAM and no MMU: it cannot run Linux, a browser or either client. No firmware changes that.
A relay or a worker does not change it either: decryption must happen in the licensed client.
Decrypting anywhere else is outside every reading of the agreement (§6) and is not a route.

**The standalone pocket DeetsPod that does work** is a small Linux board (a Pi Zero 2 W class,
$90–$140 built) running Chromium with Widevine, i.e. the Linux port on a battery
([LinuxPort.md](LinuxPort.md)); or a used iPhone SE / iPod touch ($60–$90), where Safari has
FairPlay built in. The pucks then become its knob and remote.

## 4. The shape (proposal)

The home PC is the licensed player. The puck is a far-away speaker with a screen. Nothing new
touches the DRM.

```
home PC: DeetsMusic ─ MusicKit JS plays ─ tap (worklet → Rust ring) ─ Opus encode ─ seal (§5) ─┐
                                                                                                 │ wss
                         relay (Durable Object on DeetsSupport, a blind pipe) ◄──────────────────┘
                                                                                                 │ wss (phone hotspot)
puck: open (§5) ─ Opus decode ─ 2 s jitter buffer ─ I2S → DAC / codec ─ jack or speaker ◄───────┘
      screen: cover, title, progress; knob / touch → control messages → the bridge's routes
```

**What exists today and carries this.**
- **The tap.** AirPlay's *DeetsMusic only* send already copies the decoded sound from the page
  into a Rust ring (`Capture::from_ring`). The puck stream reads the same ring. No new audio path.
- **The control routes.** The bridge answers play, queue, now playing, search, volume and settings
  for the CLI and the MCP. The puck's socket forwards the same JSON. No new commands.
- **The room socket pattern.** A Durable Object holding sockets, reconnect with backoff, rate
  limits, a short join code ([ROOMS.md](../integrations/ROOMS.md)). Reused as is.
- **The tray launch.** The app starts hidden to the tray. The home machine runs it signed in,
  lid closed, sleep off.

**The home machine is Windows today.** The app is Tauri on WebView2. A Mac mini waits for the
Linux and Mac ports. An old Windows laptop at ~10 W is about a dollar a month in power.

**Codec: Opus** at 128 kbps stereo, 20 ms frames (~320 bytes each). Transparent for music,
survives a lost packet with a short glitch, decodes on the S3 with Espressif's codec library.
About 58 MB an hour on mobile data. Raw PCM (1.4 Mbps, 630 MB an hour) rules itself out. Opus is
a compression format, not a protection: it carries no DRM and has nothing to do with Apple's.

**Sync does not matter.** Nobody hears both ends. Two seconds of buffer covers a bad hotspot.

**A phone page first.** The same relay with a web page on deets.solutions as the first client. It
makes the feature real before any firmware exists, and it is how the desk test runs. The puck is
the second client.

### 4.1 Fork T — how the puck reaches the PC (open; his call)

| | Option | Cost |
|---|---|---|
| **T1 (recommended for the first build)** | **A relay on DeetsSupport**: one Durable Object per PC; the app pushes sealed Opus frames, the puck pulls | Zero setup for a user beyond pairing. The DO stays awake while a puck listens: ~11,000 GB-s for a full day, about $0.15 a day per listening puck on the $5 plan, nothing while idle. Fine for him alone, a real bill at scale |
| T2 | **A Cloudflare Tunnel on the home PC** (cloudflared), the puck connects straight to it | Free, direct. Every user must make a Cloudflare account and install cloudflared: good for him, a wall for everyone else |
| T3 | **WebRTC peer to peer**, the worker only for signaling | Free at scale. Espressif ships `esp_webrtc`, but it is the heaviest firmware by far, and some networks still need a TURN fallback |

Build T1 behind one small socket interface so T3 can replace it later.

### 4.2 Fork S — the home PC's own speakers while the puck listens (open; his call)

The AirPlay row chose "the speaker plays, this PC goes quiet" (through the sink gain). S1: follow
it as the default. S2: keep the PC playing too, so a family at home still hears it. A box in a
closet makes the question moot. Recommendation: S1, the precedent.

### 4.3 What follows, no fork (proposal)

- **Pairing:** the puck shows a 6-character code on first boot; the user types it in Settings ›
  Remote listening on the PC; the key exchange of §5 runs; the app lists paired pucks with a
  *Forget* button. A lost or re-flashed puck re-pairs from scratch with a new code.
- **The settings:** a new section, a rule-capable key for the send (Fork S), NEW_MARKS lines, a
  Compass row, hints in the ONBOARDING ledger, toasts in TOASTS.md (the build checklist in
  CLAUDE.md applies in full).

## 5. Our own encryption on both ends (proposal, answering his ask)

TLS covers each hop to Cloudflare. It does not stop our own relay from reading the sound. End-to-end
encryption between the app and the puck makes the relay a blind pipe (it sees sizes and timing,
nothing else) and authenticates every packet, so nothing can inject audio or a Play command.

- **Pairing makes the key.** Both sides make a fresh X25519 key pair and swap public keys through
  the relay; each derives the same shared secret; both send a confirmation, an HMAC of the shared
  secret and the 6-character code. The code never crosses the wire. A passive relay learns
  nothing; an active one must guess the code in one try, and a wrong try ends the pairing.
  Bluetooth's numeric comparison, and the shape of AirPlay's own pairing.
- **The long-term pair key** comes from that secret through HKDF; it lives in the app's settings
  beside the bridge token, and in the puck's NVS. Each connection does a fresh ephemeral exchange
  signed by the pair key, so one captured session gives nothing about another.
- **Every packet** is sealed with ChaCha20-Poly1305: the Opus frame as the body, a 64-bit counter
  as the nonce, the sequence and timestamp as associated data. Control messages ride the same
  cipher on the same socket.
- **Code:** Rust has `x25519-dalek`, `hkdf` and `chacha20poly1305`, and the AirPlay crate's
  `crypto/` folder already uses this family. The ESP32's mbedTLS has X25519, HKDF and
  ChaCha20-Poly1305 built in; the S3 has hardware AES if AES-GCM is preferred.

**What it does not change.** Apple's question (§6) is whether the sound leaves the licensed client
at all, not whether our pipe is private. The encryption is for the user's privacy and the relay's
integrity: the "maximum security that still gives a great experience" rule, at no visible cost.

## 6. The terms, read against this design (2026-11-01)

The agreement is saved in [`docs/legal/`](../legal/APPLE-DPLA.md) with the two clauses quoted in
full. Point by point:

- **§7.6 (distribution).** Unchanged by this feature. The hard sentence names Apple's own platforms;
  Windows is not in the list; the exposure is the catch-all sentence. Accepted 2026-09-13, not
  re-raised.
- **§3.3.6 D, purpose:** access to the user's own subscription on the user's own device. Clean.
- **No payment or indirect monetisation.** The feature is free; a DIY puck with open firmware is
  clean. **Selling a finished puck whose point is Apple Music would need its own look; Claude's
  advice is not to sell one.**
- **Full songs, user-initiated, play / pause / skip, not misrepresented.** The puck has all three. Clean.
- **No download / upload / modify; no synchronising with other content.** A 2 s buffer is not a
  download. Re-encoding the rendered sound to Opus is a transport encoding, like AirPlay's ALAC,
  and the EQ already reshapes the rendered sound. A strict reader could still call it "modify".
  **Grey.**
- **"Only as rendered by the MusicKit APIs or MusicKit JS and only as permitted in the
  Documentation."** The clause. MusicKit JS renders the sound on the PC; the puck is an output of
  that rendering, as a HomePod is for the AirPlay send. The MusicKit JS documentation says nothing
  about outputs. The unfavourable reading: a far-away device playing a re-encoded copy is not "as
  rendered". **This is the sentence to accept on the record before anyone but him uses it, and it
  covers the AirPlay send too.**
- **Art and text not apart from playback.** The puck shows the cover only while the song plays.
  Clean. The Apple Music Identity Guidelines apply to the puck's screen.
- **MusicKit JS standalone, not re-hosted.** Untouched.

**Not read today:** the user-side Apple Media Services terms (personal, non-commercial use on
compatible devices). A second, smaller question for the record.

## 7. The firmware (proposal): Rust with esp-rs and Slint

He is willing to get in the mud, so this is the route written up; C on ESP-IDF with LVGL is the
lower-friction alternative (every vendor driver and Espressif's audio stack are C, LVGL is the
standard embedded UI kit). **Fork L (open; his call): L1 C + LVGL first, Rust for the shared
pieces once the protocol is stable · L2 Rust + Slint from the start.** Claude recommended L1 in the
talk; he leaned toward L2. Either way the shared crate below is Rust.

- **Toolchain:** `espup` installs the Xtensa Rust fork (Xtensa is not in upstream LLVM yet);
  `espflash` flashes and monitors over USB; `ldproxy` links; `esp-idf-template` makes a project.
  Windows works. Incremental builds 1–2 min, a flash ~10 s.
- **Flavour: std (`esp-idf-svc`)**, not bare-metal `esp-hal`. Wi-Fi, TLS (mbedTLS), mDNS, OTA,
  NVS and the audio stacks are in ESP-IDF; std Rust sits on top with threads, sockets and safe
  I2S / I2C wrappers. Slint's own ESP32-S3 port runs on this flavour.
- **C where it must be C:** `esp-idf-sys` builds extra ESP-IDF components from the component
  registry straight from Cargo metadata and generates bindings: the CO5300 and ST77916 panel
  drivers, the touch controllers, `esp_codec_dev` for the ES8311, and libopus (Espressif's audio
  codec component, or a fixed-point libopus through `cc`). Each gets a thin safe wrapper (~40
  lines); the rest of the firmware never sees C.
- **Slint:** declarative `.slint` files compiled into Rust; the software renderer paints line by
  line into a buffer pushed to the panel by DMA. A now-playing screen is ~100 lines. Touch, a
  rotary input mapped to focus and scroll, images, fonts, simple animations. The Deets look lives
  in its tokens as properties.
- **The payoff: one shared crate, `deets-wire`**: the pairing messages, the X25519 / HKDF
  derivation, the ChaCha20-Poly1305 frame seal, the frame header and the control message types.
  `no_std` + `alloc`, so it compiles into the app's Rust side (`src-tauri`) and into the firmware;
  the two can never disagree on a byte; its tests run on the PC.
- **The rough patches:** PSRAM and the QSPI panel need the right `sdkconfig` lines, and the errors
  when they are wrong are opaque; the jitter buffer feeding I2S by DMA without a gap is a careful
  real-time loop; when something stalls there are far fewer esp-rs examples than C ones.
- **Effort:** a weekend to run Waveshare's demos, draw a cover and hear a tone; two to three weeks of
  evenings for the real thing (pairing, the sealed socket with reconnect, Opus into I2S with the
  buffer, the now-playing screen, search over the bridge, OTA). The audio pipeline is the hard part.

## 8. Both boards, one firmware (proposal)

Both are an ESP32-S3 with 8 MB PSRAM driving a QSPI panel. The knob's second chip (the classic
ESP32) is a Bluetooth and UART co-processor; the first build leaves it idle and runs everything on
the S3 (§9 says when it earns its keep).

```
DeetsPod/
  crates/deets-wire     the shared protocol crate (also a dependency of DeetsMusic's src-tauri)
  crates/puck-core      state machine, jitter buffer, UI model, bridge client — no hardware
  crates/board-knob     ST77916 360×360, CST816, PCM5100A as a plain I2S DAC, encoder, DRV2605, TF, charger
  crates/board-amoled   CO5300 466×466, CST9217, ES8311 over I2S + I2C, AXP2101, QMI8658, two buttons
  firmware/             the binary: --features knob | amoled
  ui/*.slint            the screens, in logical sizes so they lay out at both resolutions
```

A `Board` trait: init the panel, push a frame, open the audio output, read inputs, read the
battery. Input maps differ (the knob turns for volume and scrolls lists, a press selects; the
AMOLED taps and swipes, the motion sensor wakes the screen on a lift); both feed the same model.
The relay, the pairing and the app side do not know which board they talk to.

## 9. Connectivity: what the puck needs, and the phone's battery

**Yes: the puck needs a live internet connection for the whole listening session.** The sound
comes from the home PC in real time; nothing is stored on the puck (§6 forbids a download anyway).
Away from home that connection is the phone. The honest options, 2026-11-01:

| | Route | Works today? | Strain on the phone |
|---|---|---|---|
| C1 | **Wi-Fi hotspot** from the phone (Personal Hotspot on iPhone, Hotspot on Android); the puck joins it | Yes, on both boards | The heaviest: the phone's Wi-Fi radio runs as an access point, roughly 5–10 % of its battery an hour on top of the data. iPhone turns the hotspot off when idle; the puck's stream keeps it alive |
| C2 | **Bluetooth tethering** (the PAN / BNEP profile: iPhone and Android both offer internet over Bluetooth Classic) | **Not today.** Only the knob's second chip has Bluetooth Classic, and ESP-IDF's Bluedroid stack ships no PAN profile; it would be ours to write on top of L2CAP. Throughput ~1 Mbps real, enough for 128 kbps Opus | About half the drain of a Wi-Fi hotspot: this is why phones offer it |
| C3 | **Internet over BLE** | **No.** iOS and Android give no IP over BLE to an accessory. BLE 5 could carry ~300–700 kbps of our own frames, but only a native phone app could feed it (Safari on iOS has no Web Bluetooth) | Lightest, if it existed |
| C4 | **The puck's own cellular**: an LTE Cat-1 module and a data SIM beside the S3 (Waveshare sells ESP32 + 4G boards) | Yes in principle; a different board | None on the phone. A $3–5 a month IoT SIM; the modem costs puck battery |
| C5 | **The phone as the player, the puck as a BLE remote and screen**: the phone plays Apple Music (its own app, or the web page of §4) on its own data; the knob shows the cover and turns the volume over BLE | Yes, both boards (BLE only) | The lightest real option; but the puck is then not the player, and the phone's audio goes to the phone's earbuds, not the puck's jack |
| C6 | **Bluetooth audio from the phone**: the knob's second chip as an A2DP sink + AVRCP remote; the phone plays its Apple Music app; the knob is a headphone DAC with a Deets screen | Yes, knob only (Waveshare's demo does it) | Light: Bluetooth audio is cheap for the phone. No home PC needed. The music is the phone's Apple Music app, not DeetsMusic |

### 9.1 C4 in detail: the puck's own LTE (his lean, 2026-11-01: "I don't want to rely on the phone as much as possible, purely to meet the wifi minimum")

**The module class: LTE Cat-1 (or Cat-1 bis).** 10 Mbps down, 5 Mbps up, a real IP link, on every
US carrier's 4G network. Cat-M1 and NB-IoT modules (SIM7080G class) are cheaper and thriftier but
top out near 300 kbps half-duplex and vary with the cell: too thin for a 128 kbps stream plus
control with any margin. Cat-1 is the floor.

**Candidate parts (prices 2026-11-01).**
| Part | What it is | Price |
|---|---|---|
| SIMCom **SIM7670G** (Cat-1 bis, one antenna, GNSS built in) | The module Waveshare builds on. UART AT commands plus PPP for data; USB too | ~$12–15 bare at LCSC |
| **Waveshare ESP32-S3-SIM7670G-4G** | An S3 (Waveshare says 16 MB flash / 8 MB PSRAM; resellers say less, check) with the modem, an 18650 holder, USB and solar charging, a TF slot, a camera header. **No screen, no DAC** | $48.99 |
| **Waveshare SIM7670G LTE Cat-1/GNSS HAT** | The modem on a breakout with UART and USB, meant for a Pi; wires to any board | ~$35–45 |
| SIMCom A7670 family | The sibling line (A7670E Europe, A7670SA, …); same shape, pick the region's bands | similar |

Links: [ESP32-S3-SIM7670G-4G](https://www.waveshare.com/esp32-s3-sim7670g-4g.htm) ·
[SIM7670G HAT wiki](https://www.waveshare.com/wiki/SIM7670G_LTE_Cat-1/GNSS_HAT).

**Three ways to put a modem on a puck (open).**
- **P1 — the 4G board as the brain, a screen and a DAC added.** The Waveshare 4G board already has
  the S3, the modem, the battery holder and the charger. Add a bare round QSPI panel and a $5 I2S
  DAC breakout. A bench franken-puck with no case; the quickest way to hear LTE audio.
- **P2 — keep the pucks, add a modem over UART.** The knob has a 10-pin PH1.27 header; the AMOLED
  1.75C lists none (pads to find). PPP over UART at 921600 baud gives ~700–800 kbps usable, five
  times what the stream needs. ESP-IDF's `esp_modem` component does the AT dialogue and PPP; from
  Rust it comes through `esp-idf-sys` like the panel drivers (§7). The modem's 3.8 V rail must take
  2 A bursts, so it gets its own regulator and a bigger cell than the puck's 800 mAh.
- **P3 — a custom board, the real DeetsPod.** S3 + SIM7670G + the round AMOLED + a codec + a
  2,000–3,000 mAh LiPo + charger on one PCB, assembled by JLCPCB. Where this ends up if the puck is
  ever more than one.

**Power budget (estimates; measure on the bench).**
| Draw | mA at the battery |
|---|---|
| ESP32-S3 + screen on, decoding | 120–180 |
| Cat-1 modem, mostly downlink at 128 kbps | 120–200 average; bursts to 2 A on transmit |
| **Total** | **~300–380** |
On the knob's 800 mAh cell that is about 2.5 h; on an 18650 (3,000 mAh) about 8–10 h; on a
2,000 mAh LiPo about 6 h. The LTE puck is a bigger device than the two he owns, by the battery.

**The SIM: a consumer data-only SIM, not an "IoT SIM".** At 128 kbps the stream is ~58 MB an hour,
so 20 hours a month is ~1.2 GB (96 kbps Opus, still very good, makes it ~0.86 GB). IoT SIMs
(Hologram, Soracom, 1NCE) are priced for kilobytes a day of telemetry; a gigabyte on them costs
tens to hundreds of dollars. Consumer data-only plans are the right tool: US Mobile 1 GB for $5
a month (Verizon network), Tello 2 GB for $6–10, Red Pocket from $6–10 on any of the three
networks. Prices from 2026 guides, to confirm on each carrier's site.

**The antenna (his question, 2026-11-01: "I thought the pucks already had onboard antennas?").**
They do, for 2.4 GHz: the ceramic antenna serves Wi-Fi and BLE and stays. LTE runs on other bands
(~600 MHz to 2.6 GHz in the US), so the modem brings its own antenna, usually a flexible sticker
on a short cable (~10 × 4 cm) glued inside the case; "one antenna" in the SIM7670G row means
Cat-1 bis needs one LTE antenna where older Cat-1 modules needed two. GNSS, if ever used, is a
third antenna at 1.5 GHz. **The metal cases are the constraint:** both pucks are CNC metal shells,
which block radio; their 2.4 GHz antennas sit under the glass or at a gap. An LTE antenna inside a
metal puck needs the same (under the screen, a plastic window, or outside the case), which is a
reason the quickest LTE test is the open 4G dev board, not a modem squeezed into the knob.

**Two things to check before buying a SIM.**
- **Bands.** The SIM7670G global part covers most US LTE bands but not every one (B71, T-Mobile's
  rural band, is a known gap). A Verizon- or AT&T-network plan fits it better; check the module's
  band list against the carrier.
- **IMEI acceptance.** Verizon and AT&T may refuse a device not certified on their network; MVNOs
  on T-Mobile tend to be forgiving. SIMCom lists carrier certifications for the SIM7670G; confirm
  the MVNO accepts the IMEI before the plan is paid.

**What does not change with LTE.** The home PC still plays; the puck is still the far speaker (§3).
Carrier networks put the puck behind NAT, so the puck must connect outward: Fork T1 (the relay) or
T2 (a tunnel) fit; a direct peer link (T3) needs a TURN fallback more often. LTE's 50–100 ms round
trip vanishes under the 2 s buffer. A bonus: the modem's GNSS gives the puck its own position, for
free, if a feature ever wants it.

**Bluetooth connection counts.** The S3's BLE controller handles up to 9 simultaneous links by
configuration; 3–4 is the practical number with a stream on one of them. The knob's classic ESP32
holds up to 7 Classic links in one piconet; one A2DP audio sink plus one AVRCP remote is the
realistic load. Both chips can run BLE and Wi-Fi at once (they share the 2.4 GHz antenna by time
slicing, which costs some throughput on each).

**Claude's reading, open.** C1 is the only route that makes the puck the player today, and it is
the one that costs the phone the most. C2 is the right answer on paper and a real piece of
firmware work (a PAN profile over Bluedroid's L2CAP) on the knob's second chip, which is the
first thing that would give that chip a job. C4 is the only true "on the go without the phone"
puck and changes the hardware. C5 and C6 are what the boards do well right now, and C6 is the
best use of the knob before any of §4 exists.

## 10. Costs, for the record

- **Relay (T1):** ~$0.15 a day per actively listening puck on Cloudflare's $5 plan; nothing idle.
- **Data:** ~58 MB an hour at 128 kbps.
- **Home PC:** an old laptop at ~10 W, about a dollar a month.
- **Build:** app side one Rust module (ring → Opus → sealed socket), one Settings section, pairing,
  about the size of the AirPlay sender's session code; worker one DO class, smaller than the rooms
  one; puck as §7; the phone page a day.

## 11. Open questions (his)

- Fork T (§4.1), Fork S (§4.2), Fork L (§7), and which connectivity route C (§9) the first build aims at.
- Whether the "only as rendered" sentence (§6) goes on the record now for the AirPlay send too.
- Whether a puck is ever sold, or stays a DIY device with open firmware.
