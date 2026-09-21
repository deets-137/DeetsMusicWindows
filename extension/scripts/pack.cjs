#!/usr/bin/env node
/* Build the Web Store package: node extension/scripts/pack.cjs
   Refreshes the token CSS + fonts from ../src/styles (the extension mirrors the
   app's palette → theme → skin sheets; never edit the copies), stages what ships
   into extension/dist/deetsmusic-<version>/, and zips it. No secrets exist to
   leak — the extension holds no credential at all: the app trusts its Origin
   header (docs/integrations/EXTENSION.md §3). Keep manifest.version equal to the app's. */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const app = path.join(root, "..");

/* 1. sync the shared style tier from the app */
const stylesSrc = path.join(app, "src", "styles");
const stylesDst = path.join(root, "styles");
fs.rmSync(stylesDst, { recursive: true, force: true });
fs.mkdirSync(stylesDst, { recursive: true });
for (const f of ["palette.css", "themes.css", "skin.css", "fonts.css"]) {
  fs.copyFileSync(path.join(stylesSrc, f), path.join(stylesDst, f));
}
fs.cpSync(path.join(stylesSrc, "fonts"), path.join(stylesDst, "fonts"), { recursive: true });

if (process.argv.includes("--styles-only")) {
  console.log("styles synced");
  process.exit(0);
}

/* 2. stage + zip */
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const version = manifest.version;
const dist = path.join(root, "dist");
const stage = path.join(dist, "deetsmusic-" + version);
const zip = path.join(dist, "deetsmusic-" + version + ".zip");

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.mkdirSync(stage, { recursive: true });

const SHIP = ["src", "styles", "icons", "popup", "options", "manifest.json"];
for (const item of SHIP) {
  fs.cpSync(path.join(root, item), path.join(stage, item), { recursive: true });
}

execFileSync("powershell", [
  "-NoProfile", "-Command",
  "Compress-Archive -Path '" + stage + "\\*' -DestinationPath '" + zip + "' -Force"
]);
console.log("packed " + path.relative(app, zip));
