/* DeetsMusic extension — shared module (popup + options + service worker).
   Settings defaults, the bridge client (finds the app on loopback, talks JSON),
   the YouTube title heuristics, and a tiny in-memory log the debug panel and
   "Copy report" read. Plain script (no modules) so the service worker can
   importScripts it. */
"use strict";

var DM_SHARED = (function () {
  var BUILD = "0.1.0";

  /* The app tries these in order (bridge.rs PORTS); we probe the same list. */
  var PORTS = [47825, 47826, 47827, 47828];

  var DEFAULTS = {
    token: "",              /* unused since 2026-09-09 (Origin is the credential); kept so old saves load */
    followApp: true,        /* mirror DeetsMusic's theme × skin from /health */
    theme: "lilac",
    skin: "press",
    debug: false,
    lastAppearance: null,   /* {theme, skin} cached from the last /health */
    lastPort: 0
  };

  function withDefaults(s) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = DEFAULTS[k]; });
    if (s) Object.keys(s).forEach(function (k) { if (k in DEFAULTS) out[k] = s[k]; });
    return out;
  }
  function loadSettings() {
    return new Promise(function (res) {
      chrome.storage.local.get("settings", function (r) { res(withDefaults(r && r.settings)); });
    });
  }
  function saveSettings(patch) {
    return loadSettings().then(function (s) {
      Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
      return new Promise(function (res) { chrome.storage.local.set({ settings: s }, function () { res(s); }); });
    });
  }

  /* ---- log ---- */
  var LOG = [];
  var t0 = Date.now();
  function log(tag, data) {
    var line = { t: Date.now() - t0, tag: tag, data: data };
    LOG.push(line);
    if (LOG.length > 200) LOG.shift();
    try { console.debug("[deetsmusic] " + tag, data === undefined ? "" : data); } catch (e) {}
  }
  function report() {
    return ["DeetsMusic extension report — v" + BUILD + " — " + new Date().toISOString()]
      .concat(LOG.map(function (l) {
        return String(l.t).padStart(6) + "ms  " + l.tag + (l.data !== undefined ? "  " + safeJson(l.data) : "");
      })).join("\n");
  }
  function safeJson(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }

  /* ---- bridge client ---- */
  function fetchTimeout(url, opts, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms || 1500);
    opts = opts || {};
    opts.signal = ctrl.signal;
    return fetch(url, opts).finally(function () { clearTimeout(timer); });
  }

  /* Find a running DeetsMusic: the last-known port first, then the list.
     Resolves {port, health} or rejects with "offline". */
  function findBridge(settings) {
    var order = PORTS.slice();
    if (settings.lastPort && order.indexOf(settings.lastPort) > 0) {
      order.splice(order.indexOf(settings.lastPort), 1);
      order.unshift(settings.lastPort);
    }
    var headers = settings.token ? { Authorization: "Bearer " + settings.token } : {};
    var i = 0;
    function tryNext() {
      if (i >= order.length) return Promise.reject(new Error("offline"));
      var port = order[i++];
      return fetchTimeout("http://127.0.0.1:" + port + "/health", { headers: headers }, 900)
        .then(function (r) { return r.json(); })
        .then(function (h) {
          if (!h || h.app !== "DeetsMusic") throw new Error("not deetsmusic");
          log("bridge:found", { port: port, health: h });
          return { port: port, health: h };
        })
        .catch(function (e) {
          log("bridge:probe-miss", { port: port, err: String(e && e.message || e) });
          return tryNext();
        });
    }
    return tryNext();
  }

  function call(port, settings, method, path, body) {
    var opts = { method: method, headers: { Authorization: "Bearer " + settings.token } };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetchTimeout("http://127.0.0.1:" + port + path, opts, 15000).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var err = new Error(j && j.error ? j.error : ("HTTP " + r.status));
          err.status = r.status;
          throw err;
        }
        return j;
      });
    });
  }

  /* ---- YouTube title heuristics ----
     Turn "Artist - Song (Official Video) [4K]" + a channel name into
     {title, artist}. Structured credits (the description's Music section) win
     over this whenever the page offers them; this is the fallback. */
  /* A bracket whose *contents mention* a noise word is noise entire — "(official
     visualiser w/ lyrics)", "[Official Video 4K]", "(Official Audio, prod. X)".
     This runs first: the bare-word rules below would otherwise hollow such a
     bracket out from the inside and leave "(official visualiser w/ )" behind.
     Deliberately excludes "live", "clean" and "radio edit" — those name real,
     distinct catalog tracks, so they stay exact-match-only just below. */
  var BRACKET_NOISE =
    /\s*[\(\[]\s*[^\)\]]*\b(?:official|visuali[sz]er|lyrics?|video|audio|m\/v|hd|hq|4k|8k|remastered)\b[^\)\]]*[\)\]]/gi;
  var NOISE = [
    BRACKET_NOISE,
    /\((?:official\s+)?(?:music\s+)?(?:video|audio|visuali[sz]er|lyrics?|lyric\s+video|performance\s+video|live)\)/gi,
    /\[(?:official\s+)?(?:music\s+)?(?:video|audio|visuali[sz]er|lyrics?|lyric\s+video)\]/gi,
    /\((?:hd|hq|4k|8k|remastered(?:\s+\d{4})?|explicit|clean|radio\s+edit)\)/gi,
    /\[(?:hd|hq|4k|8k|remastered(?:\s+\d{4})?|explicit|clean)\]/gi,
    /\bofficial\s+(?:music\s+)?video\b/gi,
    /\bofficial\s+audio\b/gi,
    /\blyric(?:s|\s+video)?\b/gi,
    /\bm\/v\b/gi,
    /#\w+/g,
    /\s*\|\s*.*$/,            /* "Song | Some Channel" — trailing channel tags */
    /\s*[\(\[][^\)\]a-z0-9]*[\)\]]/gi  /* brackets left empty or punctuation-only */
  ];
  function clean(s) {
    var out = s || "";
    NOISE.forEach(function (re) { out = out.replace(re, " "); });
    return out.replace(/\s+/g, " ").replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "").trim();
  }
  function stripFeat(s) {
    return (s || "").replace(/\s*[\(\[]?\s*(?:feat|ft)\.?\s+[^\)\]]*[\)\]]?/i, "").trim();
  }
  function parseTitle(rawTitle, channel) {
    var title = clean(rawTitle);
    var artist = "";
    var ch = (channel || "").trim();
    var topic = /\s-\s*topic$/i.test(ch);
    if (topic) ch = ch.replace(/\s-\s*topic$/i, "").trim();

    var m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) {
      artist = m[1].trim();
      title = m[2].trim();
    } else if (topic) {
      artist = ch;              /* auto-generated uploads: title IS the song */
    } else {
      var q = title.match(/^(.+?)\s*[:"“]\s*(.+?)["”]?$/);
      if (q && q[2].length > 2) { artist = q[1].trim(); title = q[2].trim(); }
      else if (ch && !/vevo|records|official|music|tv|channel/i.test(ch)) artist = ch;
      else if (ch) artist = ch.replace(/vevo$/i, "").trim();
    }
    title = title.replace(/^["“']+|["”']+$/g, "").trim();
    artist = stripFeat(artist).replace(/vevo$/i, "").trim();
    return { title: title, artist: artist, viaTopic: topic };
  }

  return {
    BUILD: BUILD, PORTS: PORTS, DEFAULTS: DEFAULTS,
    withDefaults: withDefaults, loadSettings: loadSettings, saveSettings: saveSettings,
    log: log, report: report,
    findBridge: findBridge, call: call,
    parseTitle: parseTitle, clean: clean
  };
})();
