/* DeetsMusic service worker — deliberately near-empty. The popup does all the
   work while it's open (read the tab, ask the app, show the match); nothing
   here owns a timer or a connection, so Chrome is free to kill it.

   Jobs: open the options page once on first install so the pairing code gets
   pasted, and answer a "ping" so the popup can tell the worker is alive. */
"use strict";

importScripts("../common/shared.js");

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener(function (msg, _sender, reply) {
  if (msg && msg.type === "dm-ping") {
    reply({ ok: true, build: DM_SHARED.BUILD });
  }
});
