/* Page readers — injected into the active tab with chrome.scripting.executeScript
   when the toolbar button is clicked (activeTab; no content script, no DOM
   changes, nothing runs until you click). Each function is serialised by Chrome
   and executed in the page, so they must be self-contained: no closures over
   this file, no DM_SHARED.

   readYouTubeDom  — isolated world: the visible title / channel / structured
                     "Music" credits in the description.
   readYouTubeMain — MAIN world: the player response (videoDetails) and the
                     description engagement panel's music rows — the same data
                     the DOM shows, but not dependent on the description being
                     expanded. Checked against the URL's video id so a stale
                     response from a previous SPA page is ignored.
   readYtMusic     — music.youtube.com's player bar. */
"use strict";

var DM_READERS = {
  readYouTubeDom: function () {
    var q = function (sel) { return document.querySelector(sel); };
    var text = function (el) { return (el && el.textContent || "").replace(/\s+/g, " ").trim(); };
    var out = { kind: "youtube", url: location.href, pageTitle: document.title, credits: {} };
    out.title = text(q("ytd-watch-metadata h1")) || text(q("h1.ytd-watch-metadata")) ||
      text(q("#title h1")) || document.title.replace(/\s*-\s*YouTube$/, "");
    out.channel = text(q("ytd-watch-metadata #owner #channel-name a")) ||
      text(q("ytd-video-owner-renderer #channel-name a")) || text(q("#upload-info #channel-name a"));

    /* Expanded description: rows titled SONG / ARTIST / ALBUM / LICENSES … */
    var rows = document.querySelectorAll(
      "ytd-video-description-music-section-renderer ytd-info-row-renderer, #music-section ytd-info-row-renderer");
    rows.forEach(function (r) {
      var k = text(r.querySelector("#title")).toLowerCase();
      var v = text(r.querySelector("#default-metadata")) || text(r.querySelector("#expanded-metadata")) ||
        text(r.querySelector("#content"));
      if (k && v) out.credits[k] = v;
    });
    /* Collapsed description: the compact "Music" card (title / artist / album). */
    var card = q("ytd-video-description-music-section-renderer yt-video-attribute-view-model, " +
      "ytd-video-description-music-section-renderer .yt-video-attribute-view-model");
    if (card) {
      var t = text(card.querySelector(".yt-video-attribute-view-model__title"));
      var a = text(card.querySelector(".yt-video-attribute-view-model__subtitle"));
      var al = text(card.querySelector(".yt-video-attribute-view-model__secondary-subtitle"));
      if (t) out.credits.song = out.credits.song || t;
      if (a) out.credits.artist = out.credits.artist || a;
      if (al) out.credits.album = out.credits.album || al;
    }
    out.musicRows = rows.length;
    return out;
  },

  readYouTubeMain: function () {
    try {
      var flexy = document.querySelector("ytd-watch-flexy");
      var pr = (flexy && flexy.playerData) || window.ytInitialPlayerResponse || null;
      var vd = pr && pr.videoDetails;
      var out = { kind: "youtube-main", urlVideoId: new URLSearchParams(location.search).get("v") };
      if (vd) {
        out.videoId = vd.videoId;
        out.title = vd.title;
        out.author = vd.author;
        out.lengthSeconds = vd.lengthSeconds;
      }
      var runs = function (o) {
        if (!o) return "";
        if (o.simpleText) return o.simpleText;
        if (o.runs) return o.runs.map(function (r) { return r.text; }).join("");
        return "";
      };
      var wn = (flexy && flexy.data) || window.ytInitialData || null;
      var panels = (wn && wn.engagementPanels) || [];
      for (var i = 0; i < panels.length; i++) {
        var items = (((panels[i].engagementPanelSectionListRenderer || {}).content || {})
          .structuredDescriptionContentRenderer || {}).items || [];
        for (var j = 0; j < items.length; j++) {
          var m = items[j].videoDescriptionMusicSectionRenderer;
          if (!m) continue;
          var lk = ((m.carouselLockups || [])[0] || {}).carouselLockupRenderer;
          var rows = (lk && lk.infoRows) || [];
          var cr = {};
          rows.forEach(function (r) {
            var ir = r.infoRowRenderer || {};
            var k = runs(ir.title).toLowerCase();
            var v = runs(ir.defaultMetadata) || runs(ir.expandedMetadata);
            if (k && v) cr[k] = v;
          });
          if (Object.keys(cr).length) out.credits = cr;
          out.musicLockups = (m.carouselLockups || []).length;
        }
      }
      return out;
    } catch (e) {
      return { kind: "youtube-main", error: String(e) };
    }
  },

  readYtMusic: function () {
    var q = function (sel) { return document.querySelector(sel); };
    var text = function (el) { return (el && el.textContent || "").replace(/\s+/g, " ").trim(); };
    var out = { kind: "ytmusic", url: location.href, pageTitle: document.title };
    var bar = q("ytmusic-player-bar");
    out.title = text(bar && bar.querySelector(".title"));
    var byline = bar && bar.querySelector(".byline");
    var parts = [];
    if (byline) {
      byline.querySelectorAll("a, span.style-scope").forEach(function (el) {
        var t = text(el);
        if (t && t !== "•" && parts.indexOf(t) < 0 && !/^\d{4}$/.test(t)) parts.push(t);
      });
      if (!parts.length) parts = text(byline).split("•").map(function (s) { return s.trim(); }).filter(Boolean);
    }
    out.artist = parts[0] || "";
    out.album = parts[1] || "";
    out.playing = !!(bar && bar.querySelector("#play-pause-button[title*='Pause'], #play-pause-button[aria-label*='Pause']"));
    return out;
  }
};
