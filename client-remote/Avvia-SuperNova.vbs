' Silent launcher — prefer local Electron; else open URL from config.txt.
Option Explicit
Dim fso, sh, folder, root, bat, cfg, url, line
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(folder)
bat = root & "\scripts\Avvia_SuperNova_Local.bat"
If Not fso.FileExists(bat) Then bat = root & "\scripts\Avvia_Biotech_Desktop.bat"
If fso.FileExists(bat) Then
  sh.Run """" & bat & """", 1, False
  WScript.Quit 0
End If

url = "http://91.99.15.48:8765/"
cfg = folder & "\config.txt"
If fso.FileExists(cfg) Then
  Dim ts
  Set ts = fso.OpenTextFile(cfg, 1)
  Do While Not ts.AtEndOfStream
    line = Trim(ts.ReadLine)
    If Len(line) > 0 And Left(line, 1) <> "#" Then
      If LCase(Left(line, 4)) = "url=" Then
        url = Trim(Mid(line, 5))
      End If
    End If
  Loop
  ts.Close
End If
If Len(url) = 0 Then url = "http://91.99.15.48:8765/"
sh.Run url, 1, False
