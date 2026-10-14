// The Tauri stand-in for a web build (docs/features/WebRooms.md §9.3 A). `@tauri-apps/api` reaches
// Rust through one global, `window.__TAURI_INTERNALS__` (invoke, the callback table, the window
// label), and the event plugin through `window.__TAURI_EVENT_PLUGIN_INTERNALS__`. Defining both
// here serves every import (core, event, window, app, opener) with no alias and no change to
// `src/`. Each web build passes its own command handler: the demo's answers with mock data
// (demo/handlers.ts), the rooms port's with the real Apple catalog (web/handlers.ts).

type Cb = (payload: unknown) => void;

/** One answer per Tauri command. The result is cloned, so the app can never change the
 *  handler's own store by mutating a result. */
export type CommandHandler = (cmd: string, args: any) => unknown | Promise<unknown>;

export interface TauriShim {
  /** Fire a Tauri event, as Rust's `app.emit` would. */
  emit(event: string, payload: unknown): void;
}

const clone = <T>(v: T): T => (v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T));

export function installTauri(handle: CommandHandler): TauriShim {
  // ── The callback table (Tauri's transformCallback / runCallback) ──
  const callbacks = new Map<number, Cb>();
  let nextId = 1;
  function transformCallback(cb?: Cb, once = false): number {
    const id = nextId++;
    callbacks.set(id, (p) => {
      if (once) callbacks.delete(id);
      cb?.(p);
    });
    return id;
  }

  // ── Events (the event plugin) ──
  const listeners = new Map<string, Map<number, number>>(); // event → eventId → callback id
  let nextEventId = 1;
  function emit(event: string, payload: unknown): void {
    const byId = listeners.get(event);
    if (!byId) return;
    for (const [eventId, cbId] of [...byId]) {
      const cb = callbacks.get(cbId);
      if (cb) queueMicrotask(() => cb({ event, id: eventId, payload }));
    }
  }

  async function invoke(cmd: string, args: any = {}): Promise<unknown> {
    switch (cmd) {
      case "plugin:event|listen": {
        const eventId = nextEventId++;
        if (!listeners.has(args.event)) listeners.set(args.event, new Map());
        listeners.get(args.event)!.set(eventId, args.handler);
        return eventId;
      }
      case "plugin:event|unlisten":
        listeners.get(args.event)?.delete(args.eventId);
        return null;
      case "plugin:event|emit":
      case "plugin:event|emit_to":
        emit(args.event, args.payload);
        return null;
    }
    return clone(await handle(cmd, args));
  }

  (window as any).__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback: (id: number) => callbacks.delete(id),
    runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
    callbacks,
    convertFileSrc: (path: string) => path,
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    plugins: { path: { sep: "/", delimiter: ":" } },
  };
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event: string, eventId: number) => listeners.get(event)?.delete(eventId),
  };
  return { emit };
}
