# Spotify desktop probe: can DeetsMusic operate the user's own Spotify app for a room?
# ideas/SpotifyRooms.md section 6, checks/README.md section 2. No app, no Spotify key, no change to anything.
#
# Run it in Windows PowerShell 5.1 (`powershell`), NOT PowerShell 7 (`pwsh`): only 5.1 can call
# the Windows media session API (Windows.Media.Control) from a script.
#
# Before you run it:
#   1. Open the Spotify desktop app, sign in, and play any song. (Windows lists Spotify's media
#      session only after it has played something.)
#   2. In Spotify, right-click a DIFFERENT song > Share > Copy Song Link. That is -Track.
#
#   powershell -File docs/ops/checks/spotify-probe.ps1 -Track <link>
#   powershell -File docs/ops/checks/spotify-probe.ps1 -Apple https://music.apple.com/us/song/<id>
#   powershell -File docs/ops/checks/spotify-probe.ps1 -Track <link> -Skip P5
#
# -Track  a Spotify song link, a spotify:track: URI or the bare 22-character id.
# -Apple  an Apple Music song link; P1 maps it to Spotify through Odesli (song.link) and uses
#         the result as -Track. Give one or both (with both, -Track wins after P1 is reported).
# -At     the seek target in seconds for P3 and P4 (default 60). Pick a song longer than -At + 20.
# -Skip   probes to skip, e.g. -Skip P1,P5.
#
# The probes (pass rules are in SpotifyRooms.md section 6):
#   P0 session  Spotify's media session: its app id, what it says it can do.
#   P1 map      Apple link -> Spotify id through Odesli, and how long it took.
#   P2 link     open spotify:track:<id> while another song plays: does it switch AND play, and when.
#   P3 seek     ask the session to seek to -At: does Spotify accept it, and where does it land.
#   P4 link@    open spotify:track:<id>#m:ss: does the song start at that time (a join without seek).
#   P5 clock    read the position 10 times a second for 10 s: how often Spotify updates it,
#               and how far its clock drifts from the wall clock.
#   P6 pause    pause and play through the session: how long until the state changes.
#
# Paste the block after "=== RESULTS ===" back into the session (or into SpotifyRooms.md section 6.2).
# "Playing" is Spotify's own report, not the sound. For P2 also listen: say if you heard the old
# song keep playing, a gap, or the new song at once.
param(
  [string]$Track = '',
  [string]$Apple = '',
  [int]$At = 60,
  [string[]]$Skip = @()
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 6) {
  Write-Host 'Run this in Windows PowerShell 5.1: powershell -File docs/ops/checks/spotify-probe.ps1 ...' -ForegroundColor Red
  exit 1
}
if (-not $Track -and -not $Apple) { Write-Host 'Give -Track (a Spotify song link) or -Apple (an Apple Music song link).' -ForegroundColor Red; exit 1 }

# --- WinRT from PowerShell 5.1: load the types, and wait on an IAsyncOperation<T> as a Task ---
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}
$Mgr = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$Props = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]

$results = [ordered]@{}
function Note($probe, $text) { $results[$probe] = $text; Write-Host "  $probe  $text" -ForegroundColor Cyan }
function Run($probe) { -not ($Skip -contains $probe) }

function TrackId($s) {
  if ($s -match '([A-Za-z0-9]{22})') { return $Matches[1] }
  throw "No Spotify track id in '$s'"
}
function Find-Spotify {
  $mgr = Await ($Mgr::RequestAsync()) $Mgr
  $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' } | Select-Object -First 1
}
function Title($s) { (Await ($s.TryGetMediaPropertiesAsync()) $Props).Title }
function Status($s) { [string]$s.GetPlaybackInfo().PlaybackStatus }
# The position now: Spotify reports a position and the time it set it; while playing, add the
# time since then.
function Pos($s) {
  $t = $s.GetTimelineProperties()
  $p = $t.Position.TotalSeconds
  if ((Status $s) -eq 'Playing') { $p += ([DateTimeOffset]::Now - $t.LastUpdatedTime).TotalSeconds }
  [math]::Round($p, 2)
}
function Fmt($sec) { '{0}:{1:D2}' -f [int][math]::Floor($sec / 60), [int]($sec % 60) }
# Opens a link and waits up to 10 s for the title to change and the state to be Playing.
function Open-And-Time($s, $uri, $before) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Start-Process $uri
  $tTitle = $null; $tPlay = $null
  while ($sw.ElapsedMilliseconds -lt 10000) {
    $title = Title $s
    if (-not $tTitle -and $title -and $title -ne $before) { $tTitle = $sw.ElapsedMilliseconds }
    if ($tTitle -and -not $tPlay -and (Status $s) -eq 'Playing') { $tPlay = $sw.ElapsedMilliseconds }
    if ($tTitle -and $tPlay) { break }
    Start-Sleep -Milliseconds 50
  }
  [pscustomobject]@{ Title = (Title $s); TitleMs = $tTitle; PlayMs = $tPlay; Status = (Status $s) }
}

Write-Host "`nSpotify desktop probe  $(Get-Date -Format 'yyyy-MM-dd HH:mm')`n"

# --- P0 session ---
$s = Find-Spotify
if (-not $s) {
  Write-Host 'No Spotify media session. Open the Spotify desktop app, play any song, run again.' -ForegroundColor Red
  exit 1
}
$c = $s.GetPlaybackInfo().Controls
$tl = $s.GetTimelineProperties()
Note 'P0' ("app id '{0}'; now '{1}' ({2}); controls play={3} pause={4} next={5} seek={6}; song end {7}" -f `
  $s.SourceAppUserModelId, (Title $s), (Status $s), $c.IsPlayEnabled, $c.IsPauseEnabled, $c.IsNextEnabled,
  $c.IsPlaybackPositionEnabled, (Fmt $tl.EndTime.TotalSeconds))

# --- P1 map ---
if ($Apple -and (Run 'P1')) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-RestMethod ("https://api.song.link/v1-alpha.1/links?userCountry=US&url=" + [uri]::EscapeDataString($Apple))
    $sp = $r.linksByPlatform.spotify
    if ($sp) {
      $id = TrackId $sp.url
      Note 'P1' ("Odesli {0} ms -> spotify:track:{1} ({2})" -f $sw.ElapsedMilliseconds, $id, $sp.url)
      if (-not $Track) { $Track = $id }
    } else {
      Note 'P1' ("Odesli {0} ms -> no Spotify match" -f $sw.ElapsedMilliseconds)
    }
  } catch { Note 'P1' ("Odesli failed after {0} ms: {1}" -f $sw.ElapsedMilliseconds, $_.Exception.Message) }
}
if (-not $Track) { Write-Host 'No Spotify track to test. Stop.' -ForegroundColor Red; $results; exit 1 }
$id = TrackId $Track

# --- P2 link ---
if (Run 'P2') {
  if ((Status $s) -ne 'Playing') { $null = Await ($s.TryPlayAsync()) ([bool]); Start-Sleep -Milliseconds 800 }
  $before = Title $s
  $o = Open-And-Time $s "spotify:track:$id" $before
  $pos = Pos $s
  Note 'P2' ("from '{0}' -> '{1}': title changed {2} ms, Playing {3} ms, state {4}, position {5} s" -f `
    $before, $o.Title, ($(if ($o.TitleMs) { $o.TitleMs } else { 'never' })), ($(if ($o.PlayMs) { $o.PlayMs } else { 'never' })),
    $o.Status, $pos)
  Start-Sleep -Seconds 3
}

# --- P3 seek ---
if (Run 'P3') {
  $from = Pos $s
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $ok = Await ($s.TryChangePlaybackPositionAsync([long]$At * 10000000)) ([bool])
  $ms = $sw.ElapsedMilliseconds
  Start-Sleep -Milliseconds 1000
  $land = Pos $s
  Note 'P3' ("seek to {0} s from {1} s: accepted={2} in {3} ms; 1 s later at {4} s (want ~{5})" -f $At, $from, $ok, $ms, $land, ($At + 1))
}

# --- P4 link with a start time ---
if (Run 'P4') {
  # Move off the song first, so the link has to load it again.
  $null = Await ($s.TrySkipNextAsync()) ([bool]); Start-Sleep -Seconds 2
  $before = Title $s
  $o = Open-And-Time $s ("spotify:track:{0}#{1}" -f $id, (Fmt $At)) $before
  Start-Sleep -Milliseconds 500
  $pos = Pos $s
  Note 'P4' ("open #{0}: '{1}', Playing {2} ms, position {3} s ({4})" -f (Fmt $At), $o.Title,
    ($(if ($o.PlayMs) { $o.PlayMs } else { 'never' })), $pos,
    ($(if ([math]::Abs($pos - $At) -lt 5) { 'started at the time' } else { 'ignored the time' })))
}

# --- P5 clock ---
if (Run 'P5') {
  if ((Status $s) -ne 'Playing') { $null = Await ($s.TryPlayAsync()) ([bool]); Start-Sleep -Milliseconds 800 }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $updates = New-Object System.Collections.Generic.List[double]
  $last = $null; $p0 = Pos $s
  while ($sw.ElapsedMilliseconds -lt 10000) {
    $t = $s.GetTimelineProperties().LastUpdatedTime
    if ($last -ne $t) { if ($last) { $updates.Add(($t - $last).TotalMilliseconds) }; $last = $t }
    Start-Sleep -Milliseconds 100
  }
  $wall = $sw.Elapsed.TotalSeconds; $p1 = Pos $s
  $gap = if ($updates.Count) { [math]::Round(($updates | Measure-Object -Average).Average) } else { 'none' }
  Note 'P5' ("{0} position updates in {1:N1} s (mean gap {2} ms); song moved {3:N2} s against {4:N2} s wall (drift {5:N0} ms)" -f `
    $updates.Count, $wall, $gap, ($p1 - $p0), $wall, ((($p1 - $p0) - $wall) * 1000))
}

# --- P6 pause / play ---
if (Run 'P6') {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $null = Await ($s.TryPauseAsync()) ([bool])
  while ((Status $s) -ne 'Paused' -and $sw.ElapsedMilliseconds -lt 5000) { Start-Sleep -Milliseconds 20 }
  $pause = $sw.ElapsedMilliseconds
  Start-Sleep -Seconds 1
  $sw.Restart()
  $null = Await ($s.TryPlayAsync()) ([bool])
  while ((Status $s) -ne 'Playing' -and $sw.ElapsedMilliseconds -lt 5000) { Start-Sleep -Milliseconds 20 }
  Note 'P6' ("Paused after {0} ms; Playing again after {1} ms" -f $pause, $sw.ElapsedMilliseconds)
}

Write-Host "`n=== RESULTS ===  $(Get-Date -Format 'yyyy-MM-dd HH:mm')  Windows $([Environment]::OSVersion.Version)"
foreach ($k in $results.Keys) { Write-Host "$k  $($results[$k])" }
Write-Host 'P2 by ear: (old song kept playing? a gap? the new song at once?)'
