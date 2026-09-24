# The beta's icon (docs/ops/BETA.md §3): app-icon.png with every hue turned 180 degrees, so
# the red D and maroon M become a teal D and a deep teal M. Lightness, saturation and alpha
# stay, so the mark keeps its shape and its edges. Then `npx tauri icon` makes the set:
#   powershell -ExecutionPolicy Bypass -File scripts/beta-icon.ps1
#   npx tauri icon app-icon-beta.png -o src-tauri/icons-beta   (delete android/ and ios/)
# Run it again whenever app-icon.png changes.
param([double]$Turn = 180)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
public static class DeetsHue {
  public static Bitmap Turn(Bitmap src, double turn) {
    var bmp = new Bitmap(src.Width, src.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
    for (int y = 0; y < src.Height; y++)
      for (int x = 0; x < src.Width; x++) {
        Color c = src.GetPixel(x, y);
        double r = c.R / 255.0, g = c.G / 255.0, b = c.B / 255.0;
        double max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
        double l = (max + min) / 2, d = max - min;
        if (c.A == 0 || d == 0) { bmp.SetPixel(x, y, c); continue; }
        double s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        double h = max == r ? ((g - b) / d) % 6 : max == g ? (b - r) / d + 2 : (r - g) / d + 4;
        h = ((h * 60 + turn) % 360 + 360) % 360;
        double C = (1 - Math.Abs(2 * l - 1)) * s;
        double X = C * (1 - Math.Abs((h / 60) % 2 - 1));
        double m = l - C / 2, rr, gg, bb;
        switch ((int)(h / 60)) {
          case 0: rr = C; gg = X; bb = 0; break;
          case 1: rr = X; gg = C; bb = 0; break;
          case 2: rr = 0; gg = C; bb = X; break;
          case 3: rr = 0; gg = X; bb = C; break;
          case 4: rr = X; gg = 0; bb = C; break;
          default: rr = C; gg = 0; bb = X; break;
        }
        Func<double, int> to = v => (int)Math.Round(Math.Min(1, Math.Max(0, v + m)) * 255);
        bmp.SetPixel(x, y, Color.FromArgb(c.A, to(rr), to(gg), to(bb)));
      }
    return bmp;
  }
}
"@
$root = Split-Path -Parent $PSScriptRoot
$src = [System.Drawing.Bitmap]::new((Join-Path $root "app-icon.png"))
$bmp = [DeetsHue]::Turn($src, $Turn)
$out = Join-Path $root "app-icon-beta.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$src.Dispose(); $bmp.Dispose()
Write-Output "beta icon: $out"
