$path = 'c:\coding\Biotech_Investment app 6\desktop-ui\src\components\CapDivStep2RiskView.tsx'
$lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)
# Log what line 130 (0-indexed) contains
[System.IO.File]::WriteAllText('c:\coding\Biotech_Investment app 6\desktop-ui\__fix_out.txt', "LINE130: $($lines[130])`nLINE131: $($lines[131])`n")
# Remove line 130 (the orphan comment with corrupted chars)
$newLines = [System.Collections.Generic.List[string]]$lines
$newLines.RemoveAt(130)
[System.IO.File]::WriteAllLines($path, $newLines, [System.Text.Encoding]::UTF8)
Add-Content 'c:\coding\Biotech_Investment app 6\desktop-ui\__fix_out.txt' "DONE"
