# CPU of one DeetsMusic process tree over -Sec seconds, split by process type (host, browser,
# renderer, gpu-process, AudioService, CdmServiceBroker…). 100 = one core. checks/README.md §2.
#
#   powershell -File docs/ops/checks/cpu-split.ps1 -Sec 20 -Label "playing"            # the live app
#   powershell -File docs/ops/checks/cpu-split.ps1 -Exe '*\target-second\*deetsmusic.exe'  # the second dev app
#
# -Exe picks the tree by the exe path (default: the installed app). A bare deetsmusic.exe with
# no children is a CLI or MCP bridge and is skipped. Use the private working set
# (heaviness-sample.ps1) for memory, never a working-set sum.
param([int]$Sec = 20, [string]$Label = '', [string]$Exe = '*\AppData\Local\DeetsMusic\current\DeetsMusic.exe')
$all = Get-CimInstance Win32_Process
$root = @($all | Where-Object { $_.ExecutablePath -like $Exe } | Where-Object { $p = $_.ProcessId; @($all | Where-Object ParentProcessId -eq $p).Count -gt 0 })[0].ProcessId
if (-not $root) { "no running app matches $Exe"; exit 1 }
$ids = @($root); $added = $true
while ($added) { $added = $false; foreach ($p in $all) { if ($ids -contains $p.ParentProcessId -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId; $added = $true } } }
$type = @{}
foreach ($id in $ids) {
  $c = $all | Where-Object ProcessId -eq $id
  $t = if ($c.CommandLine -match '--type=([\w-]+)') { $matches[1] } elseif ($c.Name -match 'msedgewebview2') { 'browser' } else { 'host' }
  if ($c.CommandLine -match '--utility-sub-type=([\w\.]+)') { $t = ($matches[1] -replace '.*\.','') }
  $type[$id] = $t
}
$a = @{}; foreach ($id in $ids) { $a[$id] = (Get-Process -Id $id).TotalProcessorTime.TotalSeconds }
$sw = [Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $Sec
$el = $sw.Elapsed.TotalSeconds
$parts = @(); $tot = 0
foreach ($id in $ids) {
  $g = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (-not $g) { continue }
  $d = 100 * ($g.TotalProcessorTime.TotalSeconds - $a[$id]) / $el
  $tot += $d
  if ($d -ge 0.5) { $parts += ('{0}={1:N1}' -f $type[$id], $d) }
}
'{0,-30} total={1,6:N1}  {2}' -f $Label, $tot, ($parts -join ' ')
