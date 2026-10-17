# The Press record's spin rate on the SECOND dev app (`npm run dev:app -- --second --built`,
# set to Press with the record showing). checks/README.md §2, WORKLOG 2026-10-17 *CPU hunt*.
# The second app cannot play (Apple refuses its license), so each run starts a hand-made spin
# on .vinyl__spin with the keyframes vinyl.ts uses: 3.6 s a turn (16⅔ rpm).
#
#   powershell -File docs/ops/checks/spin-rate.ps1                 # CPU of each rate, 15 s each
#   powershell -File docs/ops/checks/spin-rate.ps1 -Hold 120       # leave a 120 fps spin on, for an eye test
#   powershell -File docs/ops/checks/spin-rate.ps1 -Hold full      # the full display rate (as shipped)
#   powershell -File docs/ops/checks/spin-rate.ps1 -Hold off       # stop it
#
# A rate is a steps() easing: 216 steps a turn = 60 fps, 432 = 120 fps. Chromium skips a frame
# whose angle did not change, so fewer steps = fewer frames drawn.
param([string]$Hold = '')
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$cpu = Join-Path $PSScriptRoot 'cpu-split.ps1'
$exe = '*\target-second\*deetsmusic.exe'
function Ev($js) { Push-Location $repo; $o = node scripts/webview-eval.mjs --second $js; Pop-Location; $o }
function Spin($fps) {
  $easing = if ($fps -eq 'full') { 'linear' } else { "steps($([int](3.6 * [int]$fps)))" }
  Ev "(() => { window.__spinTest?.cancel(); const el = document.querySelector('.vinyl__spin'); if (!el) return 'no disc: set the Press skin with the record on'; window.__spinTest = el.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 3600, iterations: Infinity, easing: '$easing' }); return 'spinning at $fps ($easing)'; })()"
}
if ($Hold -eq 'off') { Ev "(window.__spinTest?.cancel(), 'stopped')"; exit }
if ($Hold) { Spin $Hold; exit }
Ev "(window.__spinTest?.cancel(), 'stopped')" | Out-Null
& $cpu -Sec 15 -Label 'still' -Exe $exe
foreach ($f in 'full', '120', '60', '30') { Spin $f | Out-Null; & $cpu -Sec 15 -Label "spin $f" -Exe $exe }
Ev "(window.__spinTest?.cancel(), 'stopped')" | Out-Null
