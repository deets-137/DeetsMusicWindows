// `node docs/ops/checks/layers.mjs` — list the DEV app's composited layers (CDP port 9222),
// each with its size, its element and Chromium's reasons for the layer. Text on a see-through
// layer gets grey smoothing, not ClearType (ideas/glass-text.md §2). Read-only: it changes
// nothing in the app. Made 2026-11-01 for the Glass text probes.
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const t = targets.find((x) => x.type === "page" && x.url === "http://localhost:1420/");
if (!t) { console.error("[layers] no dev app page on :9222"); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
let layers = null;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
  if (m.method === "LayerTree.layerTreeDidChange" && m.params.layers) layers = m.params.layers;
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send("DOM.enable");
await send("LayerTree.enable");
// a paint with no visible change, so the compositor sends a fresh tree
await send("Runtime.evaluate", { expression: "document.body.style.outline='0px solid transparent'; requestAnimationFrame(()=>document.body.style.outline='')" });
await new Promise((r) => setTimeout(r, 1500)); // keep the LAST tree the compositor sent
await send("DOM.getDocument", { depth: 0 });
for (const l of layers ?? []) {
  if (l.width < 40 || l.height < 40 || !l.drawsContent) continue;
  const why = await send("LayerTree.compositingReasons", { layerId: l.layerId });
  let name = "";
  if (l.backendNodeId) {
    const d = await send("DOM.describeNode", { backendNodeId: l.backendNodeId });
    const n = d.node ?? {};
    const a = n.attributes ?? [];
    const ci = a.indexOf("class");
    name = `${n.nodeName ?? ""}.${ci >= 0 ? a[ci + 1].split(" ").slice(0, 2).join(".") : ""}`;
  }
  console.log(`${String(l.width).padStart(5)}x${String(l.height).padEnd(5)} ${name.padEnd(40)} ${(why.compositingReasonIds ?? why.compositingReasons ?? []).join(",")}`);
}
ws.close();
process.exit(0);
