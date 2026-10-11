// DeetsMusic for Claude Desktop (docs/integrations/MCP-INSTALL.md §8a, fork 7A).
//
// This bundle holds no server of its own. It starts the DeetsMusic CLI that the app's
// installer put on this PC (`deetsmusic.exe mcp`) and joins its stdin and stdout to Claude.
// So the tools always come from the installed app, and this file never goes out of date.
// When DeetsMusic is not installed, it answers in MCP with one plain sentence instead.

const { spawn, execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

function findCli() {
  const local = process.env.LOCALAPPDATA;
  const usual = local ? path.join(local, "DeetsMusic", "cli", "deetsmusic.exe") : "";
  if (usual && existsSync(usual)) return usual;
  // A custom install folder: the CLI folder may be on PATH.
  try {
    const hit = execFileSync("where.exe", ["deetsmusic.exe"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0].trim();
    if (hit && existsSync(hit)) return hit;
  } catch {}
  return "";
}

const MISSING = "DeetsMusic is not installed on this PC. Install it from deets.solutions/deetsmusic, or remove this extension in Claude Desktop › Settings › Extensions.";

function answerMissing() {
  let buf = "";
  const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let req;
      try { req = JSON.parse(line); } catch { continue; }
      if (req.id === undefined) continue; // a notification needs no reply
      if (req.method === "initialize") {
        send({ id: req.id, result: {
          protocolVersion: req.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "deetsmusic", version: "0" },
          instructions: MISSING,
        } });
      } else if (req.method === "tools/list") {
        send({ id: req.id, result: { tools: [{ name: "status", description: "Says why DeetsMusic cannot be reached.", inputSchema: { type: "object", properties: {} } }] } });
      } else if (req.method === "tools/call") {
        send({ id: req.id, result: { content: [{ type: "text", text: MISSING }], isError: true } });
      } else if (req.method === "ping") {
        send({ id: req.id, result: {} });
      } else {
        send({ id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } });
      }
    }
  });
}

const cli = findCli();
if (!cli) {
  answerMissing();
} else {
  const child = spawn(cli, ["mcp"], { stdio: "inherit", windowsHide: true });
  child.on("exit", (code) => process.exit(code ?? 0));
  child.on("error", () => answerMissing());
}
