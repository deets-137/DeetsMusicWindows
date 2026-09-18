# Control DeetsMusic from an AI app or the command line

DeetsMusic can take instructions from other programs on this PC: an AI app such as Claude
Desktop, Claude Code or Cursor, or a plain terminal. They can play, pause, skip, search,
queue songs, start stations, and read what is playing. Nothing leaves your PC. The
connection is local only.

## 1. Turn it on

Open DeetsMusic › the title menu › **Settings…** › **Connections**. **Agent control** is on by
default. The line under it reads "Ready at 127.0.0.1:47825" (the port can differ). Turn the
switch off and every AI app and the command line get one reply: "Agent control is off."

## 2. Connect your AI app

Under **Agent control**, the **Copy setup for** row has one button per app. Click yours. The
exact text you need is now on the clipboard, with the right file path filled in.

**Claude Desktop.** Click **Claude Desktop**. Open the file
`%APPDATA%\Claude\claude_desktop_config.json` (create it if it is missing), paste, save,
and restart Claude Desktop. Look for the tools icon in a new chat.

**Claude Code.** Click **Claude Code**. Paste the copied line into a terminal and press
Enter. Start a new Claude Code session.

**Cursor.** Click **Cursor**. Open Cursor › Settings › MCP › Add, or paste into
`.cursor/mcp.json` in your project, then reload.

**Other apps.** Any app that can run a local MCP server over standard input and output
takes the same values: the command is the path to `deetsmusic.exe`, and the argument is `mcp`.
Choose **Other (Full)** for a large model; it gets every tool. Choose **Other (Small)** for a small
local model (LM Studio, Ollama); it gets ten simpler tools, with the arguments `mcp --small`.

ChatGPT's desktop app does not run local MCP servers, so it cannot control DeetsMusic.

## 3. What to say

Once connected, ask in plain words: "play Rumours by Fleetwood Mac", "what is playing",
"skip this", "queue the album after this one", "start a station from this song", "turn it
down to 20", "love this song", "add this to my Road Trip playlist", "is there an update",
"keep DeetsMusic on top", "switch to the night look at 9 pm", "stop the moving backgrounds".
The AI searches first, then acts on the result it found.

**When DeetsMusic asks you.** The first time an AI app adds to your Apple Music library, adds to
an Apple Music playlist, or exports a playlist, DeetsMusic shows a question. Press **Allow** to
let it, then ask the AI again. DeetsMusic asks before every playlist delete. An update never
installs until you press **Restart now**. To stop library or Apple Music playlist changes, turn
off **Add to Library** or **Export playlists** in Settings › Apple Music.

**Settings changes.** An AI app can change DeetsMusic settings too. **Settings › Connections ›
Agent changes settings** decides how: **Ask** (the default) shows a question each time, and the
change applies when you press **Allow**. **Allow** applies changes at once. **Off** refuses them.
An AI app can turn **Add to Library and ♥**, **Export playlists** and **Agent control** off, but
only you can turn them on.

## 4. The command line

The same program works as a command. It lives at
`%LOCALAPPDATA%\DeetsMusic\cli\deetsmusic.exe`. Add that folder to your PATH, or call it by
its full path.

```
deetsmusic np
deetsmusic search "blue train"
deetsmusic play song:1440857781
deetsmusic pause
deetsmusic vol 30
deetsmusic queue
```

`deetsmusic --help` lists everything.

## 5. If it does not work

| You see | Do this |
|---|---|
| "Agent control is off" | DeetsMusic › Settings › Connections › turn **Agent control** on. |
| "Waiting for the user" | Answer the question in DeetsMusic, then ask the AI again. |
| "… is off in DeetsMusic › Settings › Apple Music" | Turn that setting on if you want the AI to make the change. |
| "Agent changes settings is off" | DeetsMusic › Settings › Connections › set **Agent changes settings** to Ask or Allow. |
| "Only you can turn on …" | Turn that setting on yourself, at the place the message names. |
| "no bridge running" or a connection error | Start DeetsMusic. It must be running, in the tray is fine. |
| "not connected to Apple Music" | Sign in from the title menu › Account. |
| The AI app says the server failed to start | The path in its config points at a file that is not there. Reinstall DeetsMusic, or click **Copy setup for** again and paste the fresh text. |
| Install or uninstall says a file is in use | Quit the AI app first. It keeps `deetsmusic.exe` open while it runs. |
