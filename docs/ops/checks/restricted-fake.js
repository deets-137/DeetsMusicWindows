// Restricted songs on an Apple ID that allows them (QUEUE.md § Restricted songs). A test hook
// for the DEV app only: paste it with `node scripts/webview-eval.mjs "$(cat docs/ops/checks/restricted-fake.js)"`,
// then add the songs to refuse: `window.__rset.add("<catalog id>")`. MusicKit then refuses each
// one as an Apple ID without explicit content does:
//   - a load (setQueue, play, changeToMediaAtIndex) whose song is in the set rejects with
//     CONTENT_RESTRICTED (the click path: playTracks → load → the notice);
//   - MusicKit moving on by itself into such a song pauses and publishes `mediaPlaybackError`
//     (the auto-advance path: onPlaybackError → healDeadNext → loadPastRestricted).
// `window.__rlog` lists each refusal. Undo: `window.__rhook.off()`, then delete the three own
// properties (`delete MusicKit.getInstance().play`, `.changeToMediaAtIndex`, `.setQueue`).
// The 2026-11-16 run: click `deetsmusic --port <dev> play song:<restricted>`; then the album with
// songs 2 and 3 restricted, `seek 97%` on song 1, read the diag ring after ~14 s.
(() => {
  const m = MusicKit.getInstance();
  const R = (window.__rset ??= new Set());
  if (window.__rhook) return { already: true, set: [...R] };
  const err = () => Object.assign(new Error("CONTENT_RESTRICTED: Content restricted"), { errorCode: "CONTENT_RESTRICTED" });
  const idAt = (i) => m.queue?.items?.[i]?.id;
  const log = (window.__rlog = []);
  const o = { play: m.play.bind(m), change: m.changeToMediaAtIndex.bind(m), setQueue: m.setQueue.bind(m) };
  // A load: setQueue can start the first song by itself; a restricted first song fails the load.
  m.setQueue = async (...a) => {
    window.__rload = true;
    try {
      const r = await o.setQueue(...a);
      const id = idAt(Math.max(0, m.queue?.position ?? 0));
      if (R.has(id)) { log.push(["setQueue", id]); await Promise.resolve(m.pause()).catch(() => {}); throw err(); }
      return r;
    } finally { setTimeout(() => (window.__rload = false), 800); }
  };
  m.play = async (...a) => {
    const id = m.nowPlayingItem?.id ?? idAt(m.queue?.position ?? 0);
    if (R.has(id)) { log.push(["play", id]); throw err(); }
    return o.play(...a);
  };
  m.changeToMediaAtIndex = async (i, ...a) => {
    const id = idAt(i);
    if (R.has(id)) { log.push(["change", id]); throw err(); }
    return o.change(i, ...a);
  };
  const onChange = () => {
    const id = m.nowPlayingItem?.id;
    if (!R.has(id) || window.__rbusy || window.__rload) return;
    window.__rbusy = true;
    log.push(["advance", id]);
    Promise.resolve(m.pause()).catch(() => {}).finally(() => {
      m._services.dispatcher.publish(MusicKit.Events.mediaPlaybackError, err());
      setTimeout(() => (window.__rbusy = false), 300);
    });
  };
  m.addEventListener(MusicKit.Events.nowPlayingItemDidChange, onChange);
  window.__rhook = { off: () => { m.play = o.play; m.changeToMediaAtIndex = o.change; m.setQueue = o.setQueue; m.removeEventListener(MusicKit.Events.nowPlayingItemDidChange, onChange); R.clear(); delete window.__rhook; } };
  return { installed: true };
})()
