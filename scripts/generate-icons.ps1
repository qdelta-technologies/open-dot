Add-Type -AssemblyName System.Drawing

$srcFile = Join-Path $PSScriptRoot "..\build\icon.png"
$publicIconsDir = Join-Path $PSScriptRoot "..\public\icons"
$publicDir = Join-Path $PSScriptRoot "..\public"

if (-not (Test-Path $publicIconsDir)) {
    New-Item -ItemType Directory -Force -Path $publicIconsDir | Out-Null
}

function Resize-Image($sourcePath, $destinationPath, $w, $h) {
    $src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $sourcePath))
    $dest = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, 0, 0, $w, $h)
    $dest.Save($destinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $dest.Dispose()
    $src.Dispose()
}

Resize-Image $srcFile (Join-Path $publicIconsDir "icon-192.png") 192 192
Resize-Image $srcFile (Join-Path $publicIconsDir "icon-512.png") 512 512
Resize-Image $srcFile (Join-Path $publicIconsDir "icon-maskable.png") 512 512
Resize-Image $srcFile (Join-Path $publicIconsDir "apple-touch-icon.png") 180 180
Resize-Image $srcFile (Join-Path $publicDir "apple-touch-icon.png") 180 180

Write-Output "Successfully generated PWA icons from build/icon.png"
