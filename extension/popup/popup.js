/* Popup — the whole flow, start to finish, each time the button is clicked:
     1. find DeetsMusic on loopback (/health) — offline / refused / no Apple
        (no pairing: the app trusts the extension's Origin header)
     2. read the active tab (YouTube or YouTube Music) — nothing to send
     3. POST /resolve → show the top match with cover · title · artist · album · "+"
     4. "+" → POST /add → ✓
   "Not it?" opens a mini Search card (songs + albums, POST /search) seeded with the
   other candidates. While the popup stays open the tab is re-read every 2 s so a
   song change re-resolves on its own; the header's ↻ does it on demand.
   Nothing is automatic: no adds without a click, no page reads before the first one. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var log = DM_SHARED.log;

  var STATES = ["st-looking", "st-offline", "st-unpaired", "st-noapple", "st-nosong", "st-error", "st-match"];
  function show(id) {
    STATES.forEach(function (s) { $(s).hidden = s !== id; });
  }

  var settings = null;
  var bridge = null;      /* {port, health} */
  var read = null;        /* what the page gave us */
  var query = null;       /* what we asked the app */
  var candidates = [];
  var chosen = null;

  var ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';

  function fadeMs() {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--dur-med").trim();
    return v ? (v.slice(-2) === "ms" ? parseFloat(v) : parseFloat(v) * 1000) || 160 : 160;
  }

  /* ---- appearance: follow the app (from /health) or the options choice ---- */
  function applyAppearance(a) {
    var root = document.documentElement;
    if (settings.followApp && a && a.theme) {
      root.setAttribute("data-theme", a.theme);
      root.setAttribute("data-skin", a.skin || "press");
    } else {
      root.setAttribute("data-theme", settings.theme);
      root.setAttribute("data-skin", settings.skin);
    }
  }

  /* ---- debug panel ---- */
  function renderDebug() {
    if (!settings.debug) return;
    $("debug").hidden = false;
    var dl = $("dbg-stats");
    dl.innerHTML = "";
    var add = function (k, v) {
      var dt = document.createElement("dt"); dt.textContent = k;
      var dd = document.createElement("dd"); dd.textContent = v == null ? "—" : (typeof v === "string" ? v : JSON.stringify(v));
      dl.appendChild(dt); dl.appendChild(dd);
    };
    add("Build", DM_SHARED.BUILD);
    add("Bridge", bridge ? ("127.0.0.1:" + bridge.port + " v" + bridge.health.version +
      (bridge.health.paired ? " · paired" : " · UNPAIRED") + (bridge.health.connected ? " · Apple ok" : " · Apple NOT signed in")) : "not found");
    add("Page", read ? read.kind + " · " + (read.url || "") : "—");
    if (read) {
      add("Raw title", read.rawTitle);
      add("Channel", read.channel || read.author || "");
      add("Credits", read.credits && Object.keys(read.credits).length ? read.credits : "none");
    }
    add("Query", query);
    add("Candidates", candidates.map(function (c) {
      return "[" + c.score.toFixed(2) + "] " + c.track.title + " — " + c.track.artistName + (c.inLibrary ? " (in library)" : "");
    }));
    var ul = $("dbg-log");
    ul.innerHTML = "";
    DM_SHARED.report().split("\n").slice(1).reverse().forEach(function (line) {
      var li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    });
  }

  $("dbg-copy").addEventListener("click", function () {
    var btn = this;
    var text = DM_SHARED.report() + "\n\nread: " + JSON.stringify(read) + "\nquery: " + JSON.stringify(query) +
      "\ncandidates: " + JSON.stringify(candidates.map(function (c) { return { score: c.score, title: c.track.title, artist: c.track.artistName, id: c.track.catalogId, inLibrary: c.inLibrary }; }));
    navigator.clipboard.writeText(text).then(function () {
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = "Copy report"; }, 1200);
    });
  });
  $("dbg-applog").addEventListener("click", function () {
    if (!bridge) return;
    var out = $("dbg-applog-out");
    fetch("http://127.0.0.1:" + bridge.port + "/log", { headers: { Authorization: "Bearer " + settings.token } })
      .then(function (r) { return r.text(); })
      .then(function (t) { out.textContent = t.split("\n").slice(-40).join("\n"); out.hidden = false; })
      .catch(function (e) { out.textContent = String(e); out.hidden = false; });
  });

  $("open-options").addEventListener("click", function () { chrome.runtime.openOptionsPage(); });
  $("retry-unpaired").addEventListener("click", start);
  $("retry-offline").addEventListener("click", start);
  $("retry-error").addEventListener("click", start);
  $("refresh").addEventListener("click", function () {
    log("refresh");
    start();
  });

  /* ---- 2. read the tab ---- */
  function activeTab() {
    return new Promise(function (res) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) { res(tabs && tabs[0]); });
    });
  }
  function exec(tabId, fn, world) {
    var opts = { target: { tabId: tabId }, func: fn };
    if (world) opts.world = world;
    return chrome.scripting.executeScript(opts).then(function (r) { return r && r[0] && r[0].result; });
  }

  function readTab(tab) {
    var url = tab.url || "";
    var host = "";
    try { host = new URL(url).host; } catch (e) {}
    if (/(^|\.)music\.youtube\.com$/.test(host)) {
      return exec(tab.id, DM_READERS.readYtMusic).then(function (r) {
        log("read:ytmusic", r);
        if (!r || !r.title) return { kind: "ytmusic", none: "Play something in YouTube Music first." };
        return { kind: "ytmusic", url: r.url, rawTitle: r.title, title: r.title, artist: r.artist, album: r.album, credits: {} };
      });
    }
    if (/(^|\.)youtube\.com$/.test(host) && /\/watch\b/.test(url)) {
      return Promise.all([
        exec(tab.id, DM_READERS.readYouTubeDom),
        exec(tab.id, DM_READERS.readYouTubeMain, "MAIN").catch(function (e) { log("read:main-failed", String(e)); return null; })
      ]).then(function (pair) {
        var dom = pair[0] || {};
        var main = pair[1] || {};
        log("read:dom", dom);
        log("read:main", main);
        var mainFresh = main && main.videoId && main.videoId === main.urlVideoId;
        var credits = {};
        /* DOM rows first (what you can see), then the MAIN-world panel data */
        Object.assign(credits, mainFresh && main.credits ? main.credits : {});
        Object.assign(credits, dom.credits || {});
        var rawTitle = dom.title || (mainFresh ? main.title : "") || (tab.title || "").replace(/\s*-\s*YouTube$/, "");
        var channel = dom.channel || (mainFresh ? main.author : "") || "";
        var out = { kind: "youtube", url: dom.url || url, rawTitle: rawTitle, channel: channel, credits: credits };
        if (credits.song || credits.title) {
          out.title = credits.song || credits.title;
          out.artist = credits.artist || "";
          out.album = credits.album || "";
          out.via = "credits";
        } else {
          var p = DM_SHARED.parseTitle(rawTitle, channel);
          out.title = p.title;
          out.artist = p.artist;
          out.album = "";
          out.via = p.viaTopic ? "topic-channel" : "title-heuristic";
        }
        return out;
      });
    }
    return Promise.resolve({ kind: "other", none: /youtube\.com/.test(host)
      ? "Open a video (a /watch page) and click again."
      : "Works on YouTube and YouTube Music pages." });
  }

  /* ---- status line under the match row ----
     Opening/closing animates the row's height (the wrapper's grid-rows) so what's
     below slides; a text change while open fades out, swaps, fades in. */
  var statusTimer = 0;
  function setStatus(text) {
    var wrap = $("m-status-wrap");
    var el = $("m-status");
    clearTimeout(statusTimer);
    if (!text) {
      wrap.classList.remove("is-open");
      statusTimer = setTimeout(function () { el.textContent = ""; }, fadeMs());
      return;
    }
    if (!wrap.classList.contains("is-open") || !el.textContent) {
      el.textContent = text;
      wrap.classList.add("is-open");
      return;
    }
    if (el.textContent === text) return;
    el.style.opacity = "0";
    statusTimer = setTimeout(function () {
      el.textContent = text;
      el.style.opacity = "";
    }, fadeMs());
  }

  /* ---- add (song or album) through the bridge; the button shows busy → ✓ ---- */
  function addBtnState(btn, state) {
    btn.classList.toggle("is-busy", state === "busy");
    btn.classList.toggle("is-done", state === "done");
    btn.disabled = state !== "idle";
    btn.innerHTML = state === "done" ? ICON_CHECK : ICON_PLUS;
    btn.title = state === "done" ? "In your library" : (state === "busy" ? "Adding…" : "Add to Library");
  }
  function addViaBridge(body) {
    return DM_SHARED.call(bridge.port, settings, "POST", "/add", body);
  }

  /* ---- 3 + 4. the match ---- */
  function renderMatch(c, status) {
    chosen = c;
    var art = $("m-art");
    art.innerHTML = c.artworkUrl ? '<img alt="">' : '<span class="pop__glyph">♪</span>';
    if (c.artworkUrl) art.querySelector("img").src = c.artworkUrl;
    $("m-title").textContent = c.track.title;
    $("m-artist").textContent = c.track.artistName;
    $("m-album").textContent = c.track.albumName || "";
    var add = $("m-add");
    addBtnState(add, c.inLibrary ? "done" : "idle");
    add.title = c.inLibrary ? "Already in your library" : "Add to Library";
    setStatus(status !== undefined ? status : (c.inLibrary ? "Already in your library" : ""));
    show("st-match");
    renderDebug();
  }

  $("m-add").addEventListener("click", function () {
    if (!chosen || chosen.inLibrary) return;
    var btn = this;
    addBtnState(btn, "busy");
    setStatus("Adding…");
    log("add", { id: chosen.track.catalogId, title: chosen.track.title });
    addViaBridge({ track: chosen.track })
      .then(function () {
        chosen.inLibrary = true;
        renderMatch(chosen, "Added to your Apple Music library");
        markSongDone(chosen.track.catalogId);
        log("add:ok");
      })
      .catch(function (e) {
        log("add:failed", String(e.message || e));
        addBtnState(btn, "idle");
        setStatus("Add failed: " + (e.message || e));
      })
      .finally(renderDebug);
  });

  /* ---- the mini Search card ---- */
  var searchOpen = false;
  var searchTimer = 0;
  var searchToken = 0;
  var sInput = $("s-input");
  var sRoot = $("s-root");
  var songsById = {};   /* catalogId → candidate (rows in the card) */
  var albumsById = {};  /* catalogId → {album, artworkUrl} */

  function setSearchOpen(open) {
    searchOpen = open;
    $("m-search-wrap").classList.toggle("is-open", open);
    $("m-others").setAttribute("aria-expanded", String(open));
    $("m-others").textContent = open ? "Hide search" : "Not it? Search instead";
    if (open) setTimeout(function () { sInput.focus(); }, 50);
  }
  $("m-others").addEventListener("click", function () {
    if (!searchOpen && !sInput.value) seedSearch();
    setSearchOpen(!searchOpen);
  });

  function cover(url, cls) {
    if (url) {
      var img = document.createElement("img");
      img.className = cls; img.alt = ""; img.loading = "lazy"; img.src = url;
      return img;
    }
    var d = document.createElement("div");
    d.className = cls + " " + cls + "--empty"; d.setAttribute("aria-hidden", "true"); d.textContent = "♪";
    return d;
  }
  function addButton(done) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "search__add";
    b.setAttribute("aria-label", "Add to Apple Music library");
    addBtnState(b, done ? "done" : "idle");
    return b;
  }
  function songRow(c) {
    var id = c.track.catalogId || "";
    songsById[id] = c;
    var row = document.createElement("div");
    row.className = "search__song"; row.dataset.song = id; row.setAttribute("role", "button"); row.tabIndex = 0;
    row.appendChild(cover(c.artworkUrl, "search__song-art"));
    var txt = document.createElement("div"); txt.className = "search__song-text";
    var t = document.createElement("span"); t.className = "search__song-title"; t.textContent = c.track.title;
    var s = document.createElement("span"); s.className = "search__song-artist";
    s.textContent = c.track.artistName + (c.track.albumName ? " · " + c.track.albumName : "");
    txt.appendChild(t); txt.appendChild(s);
    row.appendChild(txt);
    row.appendChild(addButton(c.inLibrary));
    return row;
  }
  function albumTile(h) {
    var id = h.album.catalogId || "";
    albumsById[id] = h;
    var tile = document.createElement("div");
    tile.className = "search__tile"; tile.dataset.album = id;
    tile.appendChild(cover(h.artworkUrl, "search__tile-art"));
    var n = document.createElement("span"); n.className = "search__tile-name"; n.textContent = h.album.title;
    var a = document.createElement("span"); a.className = "search__tile-sub"; a.textContent = h.album.artistName;
    tile.appendChild(n); tile.appendChild(a);
    tile.appendChild(addButton(!!h.added));
    return tile;
  }
  function section(title, body) {
    var sec = document.createElement("section"); sec.className = "search__sec";
    var h = document.createElement("h3"); h.className = "search__sec-title"; h.textContent = title;
    sec.appendChild(h); sec.appendChild(body);
    return sec;
  }
  function renderSearch(songs, albums, label) {
    sRoot.innerHTML = "";
    songsById = {}; albumsById = {};
    if (songs.length) {
      var list = document.createElement("div");
      songs.forEach(function (c) { list.appendChild(songRow(c)); });
      sRoot.appendChild(section(label || "Songs", list));
    }
    if (albums.length) {
      var sc = document.createElement("div"); sc.className = "search__scroller";
      albums.forEach(function (h) { sc.appendChild(albumTile(h)); });
      sRoot.appendChild(section("Albums", sc));
    }
    if (!songs.length && !albums.length) {
      var p = document.createElement("p"); p.className = "search__prompt";
      p.textContent = label === "Other matches" ? "No other matches — try a search." : "No results.";
      sRoot.appendChild(p);
    }
  }
  /* the empty state: the other candidates from /resolve ("recommendations") */
  function seedSearch() {
    var others = candidates.filter(function (x) { return x !== chosen; });
    renderSearch(others, [], "Other matches");
  }
  function markSongDone(id) {
    if (!id || !songsById[id]) return;
    songsById[id].inLibrary = true;
    var row = sRoot.querySelector('[data-song="' + id + '"] .search__add');
    if (row) addBtnState(row, "done");
  }

  function runSearch(term) {
    var token = ++searchToken;
    $("s-bar").classList.add("search__bar--busy");
    log("search", term);
    DM_SHARED.call(bridge.port, settings, "POST", "/search", { term: term })
      .then(function (j) {
        if (token !== searchToken) return;
        var songs = (j && j.songs) || [];
        var albums = (j && j.albums) || [];
        log("search:ok", { songs: songs.length, albums: albums.length });
        renderSearch(songs, albums, "Songs");
      })
      .catch(function (e) {
        if (token !== searchToken) return;
        log("search:failed", String(e.message || e));
        sRoot.innerHTML = "";
        var p = document.createElement("p"); p.className = "search__prompt";
        p.textContent = "Search failed: " + (e.message || e);
        sRoot.appendChild(p);
      })
      .finally(function () { if (token === searchToken) $("s-bar").classList.remove("search__bar--busy"); });
  }
  sInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    $("s-clear").hidden = !sInput.value;
    var term = sInput.value.trim();
    if (!term) {
      searchToken++;
      $("s-bar").classList.remove("search__bar--busy");
      seedSearch();
      return;
    }
    searchTimer = setTimeout(function () { runSearch(term); }, 300);
  });
  $("s-clear").addEventListener("click", function () {
    sInput.value = "";
    sInput.dispatchEvent(new Event("input"));
    sInput.focus();
  });

  /* one delegated handler: "+" adds (song or album); the row itself picks that song
     as the match up top (the old "See other matches" behaviour) */
  sRoot.addEventListener("click", function (e) {
    var btn = e.target.closest(".search__add");
    var row = e.target.closest("[data-song]");
    var tile = e.target.closest("[data-album]");
    if (btn) {
      e.stopPropagation();
      if (btn.disabled) return;
      if (row) {
        var c = songsById[row.dataset.song];
        if (!c) return;
        addBtnState(btn, "busy");
        log("add:search-song", c.track.catalogId);
        addViaBridge({ track: c.track }).then(function () {
          c.inLibrary = true;
          addBtnState(btn, "done");
          if (chosen && chosen.track.catalogId === c.track.catalogId) { chosen.inLibrary = true; renderMatch(chosen, "Added to your Apple Music library"); }
          log("add:ok");
        }).catch(function (err) {
          log("add:failed", String(err.message || err));
          addBtnState(btn, "idle");
          btn.title = "Add failed: " + (err.message || err);
        });
      } else if (tile) {
        var h = albumsById[tile.dataset.album];
        if (!h) return;
        addBtnState(btn, "busy");
        log("add:search-album", h.album.catalogId);
        addViaBridge({ album: h.album }).then(function () {
          h.added = true;
          addBtnState(btn, "done");
          log("add:ok");
        }).catch(function (err) {
          log("add:failed", String(err.message || err));
          addBtnState(btn, "idle");
          btn.title = "Add failed: " + (err.message || err);
        });
      }
      return;
    }
    if (row) {
      var pick = songsById[row.dataset.song];
      if (pick) { log("pick:search", pick.track.catalogId); renderMatch(pick); }
    }
  });

  function resolve() {
    query = { title: read.title, artist: read.artist || null, album: read.album || null, source: read.kind, url: read.url };
    log("resolve", query);
    show("st-looking");
    return DM_SHARED.call(bridge.port, settings, "POST", "/resolve", query).then(function (j) {
      candidates = (j && j.candidates) || [];
      log("resolve:ok", candidates.map(function (c) { return [c.score, c.track.title, c.track.artistName]; }));
      if (!candidates.length) {
        $("nosong-title").textContent = "No match on Apple Music";
        $("nosong-note").textContent = "Looked for “" + query.title + "”" + (query.artist ? " by " + query.artist : "") + ".";
        show("st-nosong");
        renderDebug();
        return;
      }
      renderMatch(candidates[0]);
      if (searchOpen && !sInput.value) seedSearch();
    });
  }

  /* ---- live re-read: while open, notice a song change and resolve again ---- */
  var POLL_MS = 2000;
  var pollTimer = 0;
  var polling = false;
  function readKey(r) { return r ? [r.kind, r.title || "", r.artist || ""].join(" ") : ""; }
  function poll() {
    if (polling || !bridge || !bridge.health.paired || !bridge.health.connected) return;
    polling = true;
    activeTab().then(readTab).then(function (r) {
      if (readKey(r) === readKey(read)) return;
      log("poll:changed", { from: read && read.title, to: r && r.title });
      applyRead(r);
    }).catch(function (e) { log("poll:error", String(e && e.message || e)); })
      .finally(function () { polling = false; });
  }
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_MS);
  }

  /* what the page gave us → the matching state (shared by start() and the poll) */
  function applyRead(r) {
    read = r;
    log("read:result", r);
    if (r.none || !r.title) {
      $("nosong-title").textContent = r.kind === "other" ? "Open a YouTube video" : "Nothing to send";
      $("nosong-note").textContent = r.none || "Couldn't read a song title from this page.";
      $("source").hidden = true;
      show("st-nosong");
      renderDebug();
      return Promise.resolve();
    }
    $("source").textContent = r.kind === "ytmusic" ? "YouTube Music" : (r.via === "credits" ? "YouTube · credits" : "YouTube");
    $("source").hidden = false;
    sInput.value = "";
    $("s-clear").hidden = true;
    return resolve();
  }

  /* ---- 1. the flow ---- */
  function start() {
    show("st-looking");
    read = null; query = null; candidates = []; chosen = null;
    setSearchOpen(false);
    clearInterval(pollTimer);
    var rb = $("refresh");
    rb.classList.add("is-busy");
    DM_SHARED.loadSettings().then(function (s) {
      settings = s;
      applyAppearance(s.lastAppearance);
      $("debug").hidden = !s.debug;
      return DM_SHARED.findBridge(s);
    }).then(function (b) {
      bridge = b;
      var a = { theme: b.health.theme, skin: b.health.skin };
      applyAppearance(a);
      DM_SHARED.saveSettings({ lastAppearance: a, lastPort: b.port });
      if (!b.health.paired) { show("st-unpaired"); renderDebug(); return; }
      if (!b.health.connected) { show("st-noapple"); renderDebug(); return; }
      return activeTab().then(readTab).then(applyRead).then(startPolling);
    }).catch(function (e) {
      var msg = String(e && e.message || e);
      log("flow:error", msg);
      if (msg === "offline") { show("st-offline"); }
      else if (e && e.status === 401) { show("st-unpaired"); }
      else if (e && e.status === 409) { show("st-noapple"); }
      else { $("error-note").textContent = msg; show("st-error"); }
      renderDebug();
    }).finally(function () { rb.classList.remove("is-busy"); });
  }

  start();
})();
