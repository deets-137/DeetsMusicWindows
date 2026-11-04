// npm run check:os — build the whole app against each stub OS file of the OS layer, on this
// machine (docs/architecture/OS-LAYER.md §11.7). `DEETS_STUB_OS` makes build.rs pick
// `os/macos.rs` or `os/linux.rs` instead of the target's file, so a signature in a stub that drifts
// from `os/windows/` fails here, with no Mac and no cross toolchain. It checks; it never builds an
// app to run (a stub app has no media keys, no secrets and no speaker).
//
// Each OS switch re-checks only this crate (~20 s cold), and the next plain build re-checks it
// once more. The real Mac check, with the Mac's own crates, runs on a Mac (§11.3).
import { spawnSync } from "node:child_process";

const oses = process.argv.slice(2).length ? process.argv.slice(2) : ["macos", "linux"];
let failed = 0;
for (const os of oses) {
  console.log(`[check:os] cargo check against os/${os}.rs`);
  const r = spawnSync("cargo", ["check", "--quiet", "--manifest-path", "src-tauri/Cargo.toml"], {
    stdio: "inherit",
    env: { ...process.env, DEETS_STUB_OS: os },
  });
  if (r.status !== 0) {
    failed++;
    console.error(`[check:os] ${os}: FAILED`);
  }
}
if (failed) process.exit(1);
console.log(`[check:os] ok: ${oses.join(", ")}`);
