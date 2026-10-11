// Settings › Connections › Set up the DeetsMusic MCP (docs/integrations/MCP-INSTALL.md §8b).
//
// The AI apps found on this PC, one line each, inline in the My-reports idiom: a bordered
// group, the app's name with its state as a tag, *last used* as a second tag (fork 8B), and its
// one button as a `set__half`. The work is in Rust (src-tauri/src/mcp_install.rs over
// crates/mcp-install); this module keeps the panel's state and draws it. Claude Desktop's
// button opens the `.mcpb`, and Claude shows its own install screen (fork 7A).
//
// It looks again when the section opens, after each press, on the Refresh half, and when the
// window comes back to the front (the user may have just pressed Install in Claude Desktop).

import { invoke } from "@tauri-apps/api/core";
import { esc } from "./collection-card";
import { enterRows } from "./pop";
import * as diag from "./diag";

interface AppRow {
  client: string;
  label: string;
  /** not-connected · connected · stale · manual · unreadable · extension */
  state: string;
  detail?: string | null;
  /** Seconds since this app last called DeetsMusic through the MCP, this run. */
  lastUsed?: number | null;
}
interface Panel {
  entry: string;
  rows: AppRow[];
  /** Claude Desktop's extension ships with this build (the installed full app only). */
  bundle: boolean;
  others: [string, number][];
}
interface Reply {
  kind: "done" | "open" | "ask" | "failed";
  note: string;
}

const STATE_WORD: Record<string, string> = {
  "not-connected": "Not connected",
  connected: "Connected",
  stale: "Needs repair",
  manual: "Set up by hand",
  unreadable: "Cannot read",
  extension: "Extension",
};

const ago = (s: number): string => (s < 60 ? "Used just now" : s < 3600 ? `Used ${Math.round(s / 60)} min ago` : `Used ${Math.round(s / 3600)} h ago`);

export interface McpPanel {
  html: () => string;
  /** Handles a click inside the Settings body; true when it was ours. */
  click: (t: HTMLElement) => boolean;
  refresh: () => void;
  dispose: () => void;
}

export function mcpPanel(render: () => void, root: () => HTMLElement | null): McpPanel {
  let panel: Panel | null = null;
  let busy: string | null = null; // the client whose press is running
  let note: { client: string; kind: Reply["kind"]; text: string } | null = null;
  let armed: string | null = null; // a hand-made entry: the second press replaces it
  let alive = true;

  const refresh = () =>
    void invoke<Panel>("mcp_detect")
      .then((p) => {
        panel = p;
        if (alive) render();
      })
      .catch((e) => console.warn("[mcp] detect", e));

  const onFocus = () => refresh();
  window.addEventListener("focus", onFocus);
  refresh();

  const button = (r: AppRow): string => {
    const act = (verb: string, label: string, hint: string) =>
      `<button class="set__half" type="button" data-mcp-act="${verb}" data-mcp-client="${esc(r.client)}" title="${esc(hint)}"` +
      `${busy ? " disabled" : ""}>${busy === r.client ? "…" : label}</button>`;
    switch (r.state) {
      case "not-connected":
        return act("connect", "Connect", `Adds DeetsMusic to ${r.label}`);
      case "connected":
        return act("disconnect", "Disconnect", `Removes DeetsMusic from ${r.label}`);
      case "stale":
        return act("connect", "Repair", "Points the entry at this DeetsMusic again");
      case "manual":
        return armed === r.client
          ? act("replace", "Sure?", "Replaces the hand-made entry with DeetsMusic's")
          : act("connect", "Replace", "This entry starts another program. DeetsMusic asks before it changes it");
      case "extension":
        return panel?.bundle
          ? act("connect", "Install", "Opens the DeetsMusic extension in Claude Desktop, which asks you to install it")
          : "";
      default:
        return "";
    }
  };

  const html = (): string => {
    if (!panel) return "";
    if (!panel.rows.length) {
      return `<div class="set__status">No AI app found on this PC. Claude Desktop, Claude Code, Codex and ChatGPT are the ones DeetsMusic sets up.</div>`;
    }
    const rows = panel.rows
      .map((r) => {
        const used = r.lastUsed != null ? `<span class="set__tag">${esc(ago(r.lastUsed))}</span>` : "";
        const tip =
          (r.detail ? `${r.detail} · ` : "") +
          (r.lastUsed != null ? "Called DeetsMusic since it started" : "Not used since DeetsMusic started");
        const half = button(r);
        return (
          `<div class="set__row set__row--choice" title="${esc(tip)}"><span class="set__label">${esc(r.label)}` +
          `<span class="set__tag">${esc(STATE_WORD[r.state] ?? r.state)}</span>${used}</span>` +
          (half ? `<div class="set__split">${half}</div>` : "") +
          `</div>`
        );
      })
      .join("");
    const line = note ? `<div class="set__status" data-mcp-note>${esc(note.text)}</div>` : "";
    return `<div class="set__group">${rows}</div>${line}`;
  };

  const press = (client: string, verb: string) => {
    busy = client;
    armed = null;
    render();
    const call =
      verb === "disconnect"
        ? invoke<Reply>("mcp_disconnect", { client })
        : invoke<Reply>("mcp_connect", { client, replace: verb === "replace" });
    void call
      .then((r) => {
        diag.log("ui:act", { at: "mcp-setup", do: verb, client, result: r.kind });
        note = { client, kind: r.kind, text: r.note };
        if (r.kind === "ask") armed = client;
      })
      .catch((e) => {
        note = { client, kind: "failed", text: String(e) };
      })
      .finally(() => {
        busy = null;
        if (!alive) return;
        render();
        // The result line arrives like a panel row (CLAUDE.md build checklist 1).
        const el = root()?.querySelector<HTMLElement>("[data-mcp-note]");
        if (el) enterRows([el]);
        refresh();
      });
  };

  const click = (t: HTMLElement): boolean => {
    const b = t.closest<HTMLElement>("[data-mcp-act]");
    if (!b) return false;
    if (busy) return true;
    press(b.dataset.mcpClient ?? "", b.dataset.mcpAct ?? "connect");
    return true;
  };

  const dispose = () => {
    alive = false;
    window.removeEventListener("focus", onFocus);
  };

  return { html, click, refresh, dispose };
}
