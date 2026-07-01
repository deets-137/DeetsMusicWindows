# DeetsMusic — DeetsWeather (weather-driven stations & queues)

> Turn the weather outside into what's playing. Our Apple key has **WeatherKit** access, so we
> can read the local forecast and shape a **station** (endless, evolving) or a **library queue**
> (finite, snapshot) from it. Architecturally this is **not a new playback path** — a weather
> station is an [own-station](STATIONS.md#4c-our-own-station-engine) recipe whose `rules` come
> from a **weather snapshot**. Read with [STATIONS.md](STATIONS.md) (the engine this rides),
> [DATA-ARCHITECTURE.md](DATA-ARCHITECTURE.md) (provider/JWT/cache), [ALBUM-COLOR.md](ALBUM-COLOR.md)
> (an optional UI tie-in). Status: ✅ decided · 🔵 open · ⬜ later.

---

## 0. How it fits (reuse, don't reinvent)

Weather is a **rule source**, feeding the machinery we already specced:

```
WeatherKit → WeatherSnapshot → [mapping table] → station rules { bpm band, genres, era, energy }
                                                        │
                                                        ▼
                                         the own-station generator (STATIONS §4c)
                                         scope: "library" | "catalog"  ·  refills `upcoming`
```

- **Weather station** = endless + (optionally) evolving as conditions change.
- **Weather library queue** = the same mapping run **once**, `scope: "library"`, capped to a
  finite length. (It's just the snapshot, library-only, non-refilling.)
- It inherits everything from the station engine: the `scope` toggle (**within my library** vs
  **reach beyond**), BPM enrichment, the generator/`upcoming` refill, radio-mode display.

---

## 1. WeatherKit — what we get and how to call it

### Auth ⚠️ (load-bearing — it's *not* the MusicKit dev token)
WeatherKit REST needs its own JWT, **different in shape** from our MusicKit developer token:

| | claim | value |
|---|---|---|
| header | `alg` | `ES256` |
| header | `kid` | the 10-char **Key ID** (our existing `.p8`'s key id) |
| header | `id`  | `<TeamID>.<ServiceID>` |
| payload | `iss` | Team ID |
| payload | `sub` | **Service ID** (a registered identifier with WeatherKit enabled) |
| payload | `iat` / `exp` | issued / expiry |

The `.p8` private key + Team ID we already hold ([apple.rs](../src-tauri/src/apple.rs) signs the
MusicKit token from them), but WeatherKit's token adds a **`sub` = a WeatherKit-enabled
Identifier (Service ID)** and an `id` header. **VERIFY before building:** confirm such an
identifier exists on the account (the *Key* having WeatherKit capability is necessary but not
sufficient — the token needs the service id). Prove one signed call returns 200 on a throwaway,
same discipline as the DRM / MusicKit-station risks. ([auth docs](https://developer.apple.com/documentation/weatherkitrestapi/request-authentication-for-weatherkit-rest-api))

### Endpoints (`https://weatherkit.apple.com`)
- **Availability** — `GET /api/v1/availability/{lat}/{lon}?country=US` → which datasets exist here.
- **Weather** — `GET /api/v1/weather/{lang}/{lat}/{lon}?dataSets=…&timezone=…` → the data.
- **Attribution** — `GET /api/v1/attribution/{lang}` → logos + legal link (see §5, **required**).

### The signals we care about (`dataSets`)
- **`currentWeather`** — `conditionCode`, `temperature`, `temperatureApparent`, `humidity`,
  `precipitationIntensity`, `cloudCover`, `windSpeed`, `uvIndex`, `daylight` (bool), `pressure`.
- **`forecastHourly`** — per-hour condition/temp/precip-chance → **the day arc** (§3c).
- **`forecastDaily`** — `sunrise` / `sunset` / `moonPhase`, daily hi/lo → time-of-day + night.
- **`forecastNextHour`** — minute precip (where available) → a **rain interlude** trigger.
- **`weatherAlerts`** — severe weather (not musical; if displayed, must link to the event page).
- `conditionCode` is an enum (~40 values: `Clear`, `Cloudy`, `MostlyCloudy`, `Drizzle`, `Rain`,
  `HeavyRain`, `Snow`, `Flurries`, `Thunderstorms`, `Foggy`, `Haze`, `Windy`, `Hot`, …). The REST
  API doesn't publish the full list; the Swift `WeatherCondition` enum is the reference — we map a
  **curated subset** (§2), everything else → a default bucket.

### Rust (`src-tauri/src/weather.rs`, sibling to `apple.rs`)
Sign the WeatherKit JWT, call the Weather endpoint, normalize to a `WeatherSnapshot`
(condition-bucket, temp band, daylight, sun times, precip-soon, hourly arc), **cache with a
TTL** (current ~10–15 min, hourly ~1 h, daily longer) — one fetch feeds a whole session; weather
doesn't move fast. Generous free tier (commonly cited ~500k calls/mo) but we cache anyway
(stewardship). Frontend sees only the normalized `WeatherSnapshot`, never raw Apple JSON — same
rule as the music model.

---

## 2. The mapping: weather → music rules (the heart)

A **data-driven mapping table** turns a `WeatherSnapshot` into station `rules`. Keep it a table,
not hardcoded branches — it's effectively a *weather recipe* and a natural user-editable setting
later ([FUTURE-SETTINGS](FUTURE-SETTINGS.md) candidate).

**Inputs → dimensions:**
- **`conditionCode` bucket → genre/mood set (+ energy bias):** clear/sunny → upbeat pop/indie;
  rain/drizzle → lo-fi / acoustic / jazz / mellow; snow → ambient / classical / soft; storm →
  moody / cinematic / heavier; fog/haze → atmospheric / dream-pop.
- **temperature band → warmth:** cold → cozy/warm; hot → summer/bright bangers.
- **`daylight` + sun times → time-of-day arc:** morning ease-in, golden-hour, **night** (mellower
  after sunset).
- **`forecastNextHour` precip → interlude:** rain incoming ⇒ bias the next stretch mellow.

> **Reality check on available data (important, don't over-promise).** We have **BPM** (Deezer),
> **genre** (`Track.genreNames`), **release era**, and **play-stats** — but **no energy / valence
> / mood vectors** (Deezer doesn't give them; [STATIONS §4a](STATIONS.md)). So the honest mapping
> today is **genre-set + BPM band + era + popularity/play-stats** — **genre is the workhorse**,
> BPM adds tempo shaping. Richer mood (energy/valence, harmonic key) needs local
> **preview-analysis** embeddings — the same upgrade the stations spec defers. Design the mapping
> table so those columns can be *added* later without reshaping it.

Output is a normal station `rules` object, so the generator, `scope`, and enrichment all apply
unchanged.

---

## 3. Static vs evolving (the signature fork)

- **(a) Snapshot** ✅ MVP — read current weather once, build the station/queue for "now." The
  **weather library queue** is exactly this in `scope:"library"`, finite length.
- **(b) Live-evolving** — re-poll on the cache TTL; when the condition bucket changes (rain
  starts, sun sets) the generator's `rules` drift and future `upcoming` refills reflect it.
  Cheap given we already refill `upcoming` incrementally.
- **(c) Forecast-arc — "soundtrack to your day"** 🔵 the delightful one — use `forecastHourly`
  to **pre-plan a day arc**: morning upbeat → afternoon steady → evening wind-down, with a **rain
  interlude** dropped in where the forecast predicts precip. This is the feature that makes
  DeetsWeather more than a gimmick.

Recommend **snapshot first**, then **forecast-arc** as the headline, with live-evolving falling
out of the same re-poll.

---

## 4. Location (needed for the fetch)

WeatherKit needs lat/lon. Options 🔵:
- **Manual location** (a city/coords in settings) — simplest, deterministic, no permissions.
- **IP geolocation** (coarse, free) — zero-config, "good enough" for weather; a fallback.
- **OS location** (Windows Location Services via a Tauri plugin) — most accurate, most friction
  (permission prompts, desktop location is fiddly).

Recommend **manual + IP fallback** for MVP (coarse location is fine for weather); OS location
later behind a setting. Persist the choice (`deets.weather.location`).

---

## 5. UI/UX

- **Entry point:** a **Weather** station in the Stations browser (its own tile / under *My
  Stations*), whose header shows the live condition glyph + temp — e.g. **"☔ 52° · Rainy-day
  mix."** Picking it starts radio mode; the [radio-mode display](STATIONS.md#3-the-station-cards)
  shows the weather context instead of a generic station name.
- **Attribution (REQUIRED, compliance):** displaying Apple weather data obligates us to show the
  **Apple Weather** trademark/logo **and** the legal link from the **Attribution API** (and, if we
  ever surface alerts, a link to the event page). Put the logo + "Other data sources" legal link in
  the weather-station detail / an About area. Non-negotiable — bake it in from day one.
  ([attribution](https://developer.apple.com/documentation/weatherkit/weatherservice/attribution),
  [data sources](https://developer.apple.com/weatherkit/data-source-attribution/))
- **Optional flourish** ⬜ — let weather tint the UI: a rainy palette, or feed the condition into
  the [album-color aurora](ALBUM-COLOR.md)'s strength/hue. Tempting but scope-creep; note and defer.

---

## Decisions

**Closed ✅**
- Weather = a **rule source** feeding the existing own-station engine; not a new playback path.
- Two outputs, one mapping: **weather station** (endless/evolving) + **weather library queue**
  (finite snapshot, `scope:"library"`). Inherits the `scope` toggle + BPM enrichment.
- Mapping is a **data-driven table** (genre-set + BPM + era + play-stats today; mood columns
  addable later); genre is the workhorse given no energy/valence data.
- **Attribution is mandatory** and designed in from the start.
- Normalized `WeatherSnapshot` model (Rust); frontend never sees raw Apple JSON; cached with TTL.

**Open 🔵**
- **Snapshot vs forecast-arc first** — recommend snapshot MVP, forecast-arc as the headline next.
- **Location source** — recommend manual + IP fallback; OS location later.
- **Mapping richness** — genre-only vs genre+BPM at launch (recommend genre+BPM; it's cheap once
  enrichment exists).
- **Weather-tints-the-UI** flourish — in or deferred (recommend deferred).

---

## Risks / verify
- **WeatherKit token shape + Service ID** (§1) — the load-bearing unknown; the token differs from
  the MusicKit dev token and needs a WeatherKit-enabled identifier as `sub`. Prove one 200 on a
  throwaway before building.
- **Attribution compliance** — must ship with the logo + legal link; easy to forget, not optional.
- **Mapping quality with only genre + BPM** — may feel coarse without mood vectors; set
  expectations and keep the preview-analysis upgrade path open.
- **Location acquisition on Windows** — the fiddliest bit; manual/IP sidesteps it for MVP.
- **Over-fetching** — cache by TTL; one snapshot should power a whole listening session.
