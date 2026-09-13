# One "heaviness" sample of every running DeetsMusic app (installed and dev), printed
# as one line per app — DEBUGGING.md §Heaviness. Run it by hand, or loop it:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/heaviness-sample.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/heaviness-sample.ps1 -Loop 3600
#
# -Loop N repeats every N seconds and appends to scripts/heaviness-samples.log (gitignored)
# until you close the terminal, so a multi-hour run does not need a Claude session alive.
#
# Per app tree (rooted at the exe with WebView2 children): the summed working set, the
# largest renderer (the page), the GPU process, and a 5 s CPU rate where 100 = one core.
# `dev` = the exe under src-tauri/target; `installed` = anything else. Bare deetsmusic.exe
# processes with no children are the CLI / MCP bridges and are skipped.
# Then, if the DEV app answers on its CDP port, the page's own JS heap, DOM node count and
# <img> count (via scripts/webview-eval.mjs) — the leak signal: a heap or DOM that only
# ever grows across samples while the app is used.
param([int]$Loop = 0)

$root = Split-Path $PSScriptRoot -Parent
$logFile = Join-Path $PSScriptRoot "heaviness-samples.log"

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
  $t0 = Get-Date; Start-Sleep -Seconds 5; $el = ((Get-Date) - $t0).TotalSeconds
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm')
  $lines = @()
  foreach ($rootId in ($tree.Values | Sort-Object -Unique)) {
    $kids = @($tree.Keys | Where-Object { $tree[$_] -eq $rootId })
    if ($kids.Count -lt 3) { continue }
    $rootProc = Get-Process -Id $rootId -ErrorAction SilentlyContinue
    $label = if ($rootProc -and ($rootProc.Path -match '\\target\\')) { 'dev' } else { 'installed' }
    $ws = 0.0; $cpu = 0.0; $ren = 0.0; $gpu = 0.0; $up = 0
    foreach ($id in $kids) {
      $g = Get-Process -Id $id -ErrorAction SilentlyContinue; if (-not $g) { continue }
      $w = $g.WorkingSet64 / 1MB; $ws += $w
      if ($a.ContainsKey($id)) { $cpu += 100 * ($g.TotalProcessorTime.TotalSeconds - $a[$id]) / $el }
      $cmd = $byId[$id].CommandLine
      if ($cmd -match '--type=renderer') { if ($w -gt $ren) { $ren = $w } }
      elseif ($cmd -match '--type=gpu-process') { $gpu = $w }
      if ($id -eq $rootId) { $up = [math]::Round(((Get-Date) - $g.StartTime).TotalMinutes) }
    }
    $lines += "$stamp $label up=${up}min total=$([math]::Round($ws))MB renderer=$([math]::Round($ren))MB gpu=$([math]::Round($gpu))MB cpu=$([math]::Round($cpu,1))%"
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
