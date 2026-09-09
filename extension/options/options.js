/* Options — connection check, look, debug. Saves on change; "Test connection" hits
   /health so you see found / Apple-signed-in without opening a video. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var settings;

  function applyLook() {
    var root = document.documentElement;
    var a = settings.followApp && settings.lastAppearance;
    root.setAttribute("data-theme", a && a.theme ? a.theme : settings.theme);
    root.setAttribute("data-skin", a && a.skin ? a.skin : settings.skin);
    $("pick").classList.toggle("is-off", !!settings.followApp);
  }

  function save(patch) {
    return DM_SHARED.saveSettings(patch).then(function (s) { settings = s; applyLook(); });
  }

  DM_SHARED.loadSettings().then(function (s) {
    settings = s;
    $("follow").checked = s.followApp;
    $("theme").value = s.theme;
    $("skin").value = s.skin;
    $("debug").checked = s.debug;
    applyLook();
  });

  $("follow").addEventListener("change", function () { save({ followApp: this.checked }); });
  $("theme").addEventListener("change", function () { save({ theme: this.value }); });
  $("skin").addEventListener("change", function () { save({ skin: this.value }); });
  $("debug").addEventListener("change", function () { save({ debug: this.checked }); });

  $("test").addEventListener("click", function () {
    var st = $("status");
    st.className = "opt__status";
    st.textContent = "Looking…";
    DM_SHARED.findBridge(settings).then(function (b) {
      var h = b.health;
      save({ lastAppearance: { theme: h.theme, skin: h.skin }, lastPort: b.port });
      if (!h.paired) { st.className = "opt__status is-bad"; st.textContent = "Found DeetsMusic on port " + b.port + ", but it didn't accept this extension."; return; }
      st.className = "opt__status is-ok";
      st.textContent = "Connected to DeetsMusic v" + h.version + " on port " + b.port + (h.connected ? " · Apple Music signed in" : " · sign in to Apple Music in the app");
    }).catch(function () {
      st.className = "opt__status is-bad";
      st.textContent = "DeetsMusic isn't running (or its bridge port is blocked).";
    });
  });
})();
