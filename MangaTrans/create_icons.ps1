param(
    [string]$outDir = "icons"
)

# Thư mục chứa icon
$targetDir = Join-Path $PSScriptRoot $outDir
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir | Out-Null
}

Add-Type -AssemblyName System.Drawing

function Create-Icon([int]$size, [string]$filename) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    # Thiết lập khử răng cưa chất lượng cao
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    
    # 1. Vẽ nền gradient bo góc
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 99, 102, 241), # Indigo (#6366F1)
        [System.Drawing.Color]::FromArgb(255, 59, 130, 246), # Blue (#3B82F6)
        45.0 # Góc gradient
    )
    
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $radius = $size * 0.25
    $path.AddArc(0, 0, $radius, $radius, 180, 90)
    $path.AddArc(($size - $radius), 0, $radius, $radius, 270, 90)
    $path.AddArc(($size - $radius), ($size - $radius), $radius, $radius, 0, 90)
    $path.AddArc(0, ($size - $radius), $radius, $radius, 90, 90)
    $path.CloseFigure()
    
    $g.FillPath($brush, $path)
    
    # 2. Vẽ bong bóng thoại màu trắng
    $bubbleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $bubblePath = New-Object System.Drawing.Drawing2D.GraphicsPath
    
    # Kích thước bong bóng thoại
    $bx = $size * 0.15
    $by = $size * 0.15
    $bw = $size * 0.7
    $bh = $size * 0.55
    $br = $size * 0.15
    
    $bubblePath.AddArc($bx, $by, $br, $br, 180, 90)
    $bubblePath.AddArc(($bx + $bw - $br), $by, $br, $br, 270, 90)
    $bubblePath.AddArc(($bx + $bw - $br), ($by + $bh - $br), $br, $br, 0, 90)
    # Vẽ đuôi bong bóng thoại
    $bubblePath.AddLine(($bx + $bw * 0.6), ($by + $bh), ($bx + $bw * 0.45), ($by + $bh + $size * 0.15))
    $bubblePath.AddLine(($bx + $bw * 0.45), ($by + $bh + $size * 0.15), ($bx + $bw * 0.35), ($by + $bh))
    $bubblePath.AddArc($bx, ($by + $bh - $br), $br, $br, 90, 90)
    $bubblePath.CloseFigure()
    
    $g.FillPath($bubbleBrush, $bubblePath)
    
    # 3. Vẽ chữ "A" để biểu thị dịch thuật
    $fontSize = $size * 0.35
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 31, 41, 55)) # Xám đậm (#1F2937)
    
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    
    # Điều chỉnh vùng vẽ chữ
    $textRect = New-Object System.Drawing.RectangleF ($bx), ($by + $size * 0.02), ($bw), ($bh)
    $g.DrawString("A", $font, $textBrush, $textRect, $sf)
    
    # Giải phóng tài nguyên
    $font.Dispose()
    $textBrush.Dispose()
    $bubbleBrush.Dispose()
    $brush.Dispose()
    $g.Dispose()
    
    # Lưu file
    $outPath = Join-Path $targetDir $filename
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

Create-Icon 16 "icon16.png"
Create-Icon 48 "icon48.png"
Create-Icon 128 "icon128.png"

Write-Host "Icons generated successfully in $($targetDir)!"
