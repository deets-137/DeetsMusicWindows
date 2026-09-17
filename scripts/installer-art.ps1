# Draws the installer's side image (src-tauri/nsis/sidebar.bmp): Deets and Happy on the
# street of the night skyline. NSIS shows it on the Welcome and Finish pages
# (bundle.windows.nsis.sidebarImage, RELEASE.md §3). Run again after a source changes:
#   powershell -NoProfile -File scripts/installer-art.ps1
#
# Sources (src-tauri/nsis/art/): deets.png (32 x 64, the user's sprite), happy.png (32 x 32,
# DeetsSolutions assets/sprites/happy/idle_down.png), skyline.png (120 x 120, art in rows 0-92).
# The scene is built at 82 x 157 and doubled with nearest-neighbour, so every art pixel is a
# crisp 2 x 2 block in NSIS's 164 x 314 strip (24-bit BMP, no alpha).

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$art = Join-Path $root "src-tauri\nsis\art"
$out = Join-Path $root "src-tauri\nsis\sidebar.bmp"
function Load($name) { [System.Drawing.Bitmap]::FromFile((Join-Path $art $name)) }
function Rgb($r, $g, $b) { [System.Drawing.Color]::FromArgb(255, $r, $g, $b) }

$skyline = Load "skyline.png"
$deets = Load "deets.png"
$happy = Load "happy.png"

$cw = 82; $ch = 157
$artH = 93                 # the skyline's rows that hold art; the rest is empty
$top = $ch - $artH         # the skyline sits on the bottom edge; the sky above is drawn
$scene = New-Object System.Drawing.Bitmap $cw, $ch, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

# The skyline, left-aligned so its moon corner is in frame. The moon (9 x 9, rows/cols 0-8)
# and its black frame (row/col 9-10) move up into the new sky: the corner is refilled with the
# sky band around it.
$moon = New-Object System.Drawing.Bitmap 9, 9
for ($x = 0; $x -lt $cw; $x++) {
  for ($y = 0; $y -lt $artH; $y++) {
    $c = $skyline.GetPixel($x, $y)
    if ($x -lt 9 -and $y -lt 9) { $moon.SetPixel($x, $y, $c) }
    if ($x -lt 10 -and $y -lt 11) { $c = Rgb 42 42 61 }
    $scene.SetPixel($x, $top + $y, $c)
  }
}

# The sky: the art's own purples, darkest at the top, a checker pair of rows at each step.
$bands = @((Rgb 22 16 34), (Rgb 34 22 46), (Rgb 46 26 54), (Rgb 38 38 69))
$edges = @(18, 38, 54)
for ($y = 0; $y -lt $top; $y++) {
  $i = @($edges | Where-Object { $y -ge $_ }).Count
  for ($x = 0; $x -lt $cw; $x++) {
    $c = $bands[$i]
    if ($i -gt 0 -and ($y - $edges[$i - 1]) -lt 2 -and (($x + $y) % 2) -eq 0) { $c = $bands[$i - 1] }
    $scene.SetPixel($x, $y, $c)
  }
}
# A checker row into the art's first row, so the join is not a straight line.
for ($x = 0; $x -lt $cw; $x++) {
  if ((($x + $top) % 2) -eq 0) { $scene.SetPixel($x, $top - 1, $scene.GetPixel($x, $top)) }
}

# Stars, fixed places (W = the moon's cream, B = the windows' pale blue).
$stars = @(@(41,9,'W'),@(6,4,'B'),@(12,23,'B'),@(64,13,'W'),@(55,26,'W'),@(11,35,'W'),@(72,7,'B'),
           @(80,40,'B'),@(7,36,'B'),@(6,14,'W'),@(17,18,'W'),@(69,7,'B'),@(71,52,'B'),@(13,37,'B'))
foreach ($s in $stars) {
  $c = if ($s[2] -eq 'W') { Rgb 238 195 154 } else { Rgb 203 219 252 }
  $scene.SetPixel($s[0], $s[1], $c)
}

$g = [System.Drawing.Graphics]::FromImage($scene)
$g.InterpolationMode = "NearestNeighbor"
$g.PixelOffsetMode = "Half"
$g.DrawImage($moon, 58, 9, 9, 9)
# Both stand on the street (the skyline's black band starts at art row 81), feet 2 px in.
$street = $top + 81
$g.DrawImage($deets, 10, $street + 2 - 58, 32, 64)   # deets.png: feet on row 58
$g.DrawImage($happy, 40, $street + 2 - 32, 32, 32)   # happy.png: feet on row 32
$g.Dispose()

$strip = New-Object System.Drawing.Bitmap 164, 314, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($strip)
$g.InterpolationMode = "NearestNeighbor"
$g.PixelOffsetMode = "Half"
$g.DrawImage($scene, 0, 0, 164, 314)
$g.Dispose()
$strip.Save($out, [System.Drawing.Imaging.ImageFormat]::Bmp)

foreach ($b in @($strip, $scene, $moon, $skyline, $deets, $happy)) { $b.Dispose() }
Write-Output "wrote $out"
