# One "heaviness" sample of every running DeetsMusic app (installed and dev), printed
# as one line per app — DEBUGGING.md §Heaviness. Run it by hand, or loop it:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/heaviness-sample.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/heaviness-sample.ps1 -Loop 3600
#
# -Loop N repeats every N seconds and appends to scripts/heaviness-samples.log (gitignored)
# until you close the terminal, so a multi-hour run does not need a Claude session alive.
#
# Per app tree (rooted at the exe with WebView2 children): the summed working set, a
# 5 s CPU rate where 100 = one core, and — since 2026-09-17 — the split per process type
# and the app context. `dev` = the exe under src-tauri/target; `installed` = anything
# else. Bare deetsmusic.exe processes with no children are the CLI / MCP bridges and are
# skipped.
#
# The split (DEBUGGING.md §2026-09-17 review, item 1) names every process in the tree,
# not only the renderer and the GPU: host (the Rust exe), webview (the WebView2 browser
# process), renderer, gpu, audio, network, cdm (the Widevine sandbox that decrypts the
# stream), utility, other. Each is `MB/CPU%`, and the parts add up to `total`, so a
# climb has a name.
#
# The context comes from the app bridge: GET /health on 127.0.0.1:47825-47828 is
# unauthenticated and answers skin, theme, surface, playing, airplay, sound, vinyl, tray.
# Each answer is filed under the process that holds the port, so both apps get their own.
# An app older than this change answers skin and theme only, and the rest is left out. No
# token is read and no title or artist is asked for.
#
# Then, if the DEV app answers on its CDP port, the page JS heap, DOM node count and
# <img> count (via scripts/webview-eval.mjs) — the leak signal: a heap or DOM that only
# ever grows across samples while the app is used.
param([int]$Loop = 0)

$root = Split-Path $PSScriptRoot -Parent
$logFile = Join-Path $PSScriptRoot "heaviness-samples.log"

# Which bucket a process belongs to, from its name and command line. A process with no
# `--type=` is a parent: the Rust exe (host) or the WebView2 browser process (webview),
# which is the one that owns the other WebView2 children.
function Get-Bucket($name, $cmd) {
  if (-not $cmd -or $cmd -notmatch '--type=') {
    if ($name -match '^deetsmusic\.exe$') { return 'host' }
    return 'webview'
  }
  if ($cmd -match '--type=renderer') { return 'renderer' }
  if ($cmd -match '--type=gpu-process') { return 'gpu' }
  if ($cmd -match '--type=crashpad-handler') { return 'other' }
  if ($cmd -match '--type=utility') {
    if ($cmd -match '--utility-sub-type=audio\.mojom') { return 'audio' }
    if ($cmd -match '--utility-sub-type=network\.mojom') { return 'network' }
    if ($cmd -match '--utility-sub-type=media\.mojom\.CdmService') { return 'cdm' }
    return 'utility'
  }
  return 'other'
}

# The app answer to "what were you doing". Loopback, unauthenticated, no token. Every
# bridge port is asked, and each answer is filed under the process that holds the port, so
# the installed app and the dev app each get their own context.
function Get-Context {
  $out = @{}
  foreach ($port in 47825, 47826, 47827, 47828) {
    try {
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2 -ErrorAction Stop
    } catch { continue }
    if (-not $h.ok) { continue }
    $owner = (Get-NetTCPConnection -LocalPort $port -State Listen -EA SilentlyContinue | Select-Object -First 1).OwningProcess
    $bits = @()
    if ($h.skin) { $bits += "skin=$($h.skin)" }
    if ($h.theme) { $bits += "theme=$($h.theme)" }
    if ($h.surface) { $bits += "surface=$($h.surface)" }
    if ($null -ne $h.playing) { $bits += "playing=$(if ($h.playing) { 'yes' } else { 'no' })" }
    if ($h.airplay) { $bits += "airplay=$($h.airplay)" }
    if ($null -ne $h.sound) { $bits += "sound=$(if ($h.sound) { 'on' } else { 'off' })" }
    if ($h.vinyl) { $bits += "vinyl=$($h.vinyl)" }
    if ($null -ne $h.tray) { $bits += "tray=$(if ($h.tray) { 'hidden' } else { 'shown' })" }
    if ($owner) { $out[[int]$owner] = ($bits -join ' ') }
  }
  return $out
}

function Sample-Once {
  $procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'deetsmusic|msedgewebview2' } | Select-Object ProcessId, ParentProcessId, Name, CommandLine
  $byId = @{}; foreach ($p in $procs) { $byId[$p.ProcessId] = $p }
  $tree = @{}
  foreach ($p in $procs) {
    $id = $p.ProcessId; $n = 0; $r = 0
    while ($byId.ContainsKey($id) -and $n -lt 10) { $q = $byId[$id]; if ($q.Name -match '^deetsmusic\.exe$') { $r = $id; break }; $id = $q.ParentProcessId; $n++ }
    if ($r -ne 0) { $tree[$p.ProcessId] = $r }
  }
  $a = @{}; foreach ($id in $tree.Keys) { $g = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($g) { $a[$id] = $g.TotalProcessorTime.TotalSeconds } }
  # The context is read while the CPU window runs, so the sample costs no extra time.
  $t0 = Get-Date
  $ctx = Get-Context
  $wait = 5 - ((Get-Date) - $t0).TotalSeconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
  $el = ((Get-Date) - $t0).TotalSeconds
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm')
  $lines = @()
  $order = 'host', 'webview', 'renderer', 'gpu', 'audio', 'network', 'cdm', 'utility', 'other'
  foreach ($rootId in ($tree.Values | Sort-Object -Unique)) {
    $kids = @($tree.Keys | Where-Object { $tree[$_] -eq $rootId })
    if ($kids.Count -lt 3) { continue }
    $rootProc = Get-Process -Id $rootId -ErrorAction SilentlyContinue
    $label = if ($rootProc -and ($rootProc.Path -match '\\target\\')) { 'dev' } else { 'installed' }
    $ws = 0.0; $cpu = 0.0; $ren = 0.0; $gpu = 0.0; $up = 0
    $bw = @{}; $bc = @{}; $bn = @{}
    foreach ($id in $kids) {
      $g = Get-Process -Id $id -ErrorAction SilentlyContinue; if (-not $g) { continue }
      $w = $g.WorkingSet64 / 1MB; $ws += $w
      $c = 0.0
      if ($a.ContainsKey($id)) { $c = 100 * ($g.TotalProcessorTime.TotalSeconds - $a[$id]) / $el; $cpu += $c }
      $cmd = $byId[$id].CommandLine
      $b = Get-Bucket $byId[$id].Name $cmd
      $bw[$b] = [double]$bw[$b] + $w; $bc[$b] = [double]$bc[$b] + $c; $bn[$b] = [int]$bn[$b] + 1
      if ($b -eq 'renderer') { if ($w -gt $ren) { $ren = $w } }
      elseif ($b -eq 'gpu') { $gpu = $w }
      if ($id -eq $rootId) { $up = [math]::Round(((Get-Date) - $g.StartTime).TotalMinutes) }
    }
    # Kept for the older rows in the log: total, the biggest renderer, the GPU process.
    $line = "$stamp $label up=${up}min total=$([math]::Round($ws))MB renderer=$([math]::Round($ren))MB gpu=$([math]::Round($gpu))MB cpu=$([math]::Round($cpu,1))%"
    $split = @()
    foreach ($b in $order) {
      if (-not $bw.ContainsKey($b)) { continue }
      $n = if ($bn[$b] -gt 1) { "x$($bn[$b])" } else { '' }
      $split += "$b$n=$([math]::Round($bw[$b]))MB/$([math]::Round($bc[$b],1))%"
    }
    $line += " | " + ($split -join ' ')
    # The keys are [int]; a CIM ProcessId is [uint32], so the cast is what makes it match.
    if ($ctx.ContainsKey([int]$rootId)) { $line += " | " + $ctx[[int]$rootId] }
    $lines += $line
  }
  $evalJs = "(() => { const m = performance.memory; return 'heap=' + (m.usedJSHeapSize/1048576).toFixed(1) + 'MB dom=' + document.getElementsByTagName('*').length + ' imgs=' + document.images.length + ' up=' + (performance.now()/60000).toFixed(0) + 'min'; })()"
  $page = & node (Join-Path $PSScriptRoot "webview-eval.mjs") $evalJs 2>$null
  if ($LASTEXITCODE -eq 0 -and $page) { $lines += "$stamp dev-page $($page -replace '"','')" }
  return $lines
}

if ($Loop -le 0) { Sample-Once; exit 0 }
while ($true) {
  $out = Sample-Once
  $out | ForEach-Object { $_ }
  $out | Out-File -FilePath $logFile -Append -Encoding utf8
  Start-Sleep -Seconds $Loop
}
