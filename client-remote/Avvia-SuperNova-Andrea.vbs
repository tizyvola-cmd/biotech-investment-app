' SuperNova Andrea — prefer local Electron; fallback to Edge profile on VPS only if no repo.
Option Explicit
Dim fso, sh, folder, root, bat, edge, chrome, url, profile, cfg, line, key, val, p
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(folder)
bat = root & "\scripts\Avvia_SuperNova_Andrea.bat"
If fso.FileExists(bat) Then
  sh.Run """" & bat & """", 1, False
  WScript.Quit 0
End If

url = "http://91.99.15.48:8765/"
profile = "SuperNova-Andrea"
cfg = folder & "\config-andrea.txt"
If fso.FileExists(cfg) Then
  Dim ts
  Set ts = fso.OpenTextFile(cfg, 1)
  Do While Not ts.AtEndOfStream
    line = Trim(ts.ReadLine)
    If Len(line) > 0 And Left(line, 1) <> "#" Then
      If InStr(line, "=") > 0 Then
        key = LCase(Trim(Left(line, InStr(line, "=") - 1)))
        val = Trim(Mid(line, InStr(line, "=") + 1))
        If key = "url" And Len(val) > 0 Then url = val
        If key = "profile" And Len(val) > 0 Then profile = val
      End If
    End If
  Loop
  ts.Close
End If
If InStr(url, "?") = 0 Then url = url & "?v=andrea-local-fallback"

edge = ""
p = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
If fso.FileExists(p) Then edge = p
p = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
If fso.FileExists(p) Then edge = p

chrome = ""
p = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
If fso.FileExists(p) Then chrome = p
p = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe"
If fso.FileExists(p) Then chrome = p

If Len(edge) > 0 Then
  sh.Run """" & edge & """ --profile-directory=""" & profile & """ --new-window """ & url & """", 1, False
ElseIf Len(chrome) > 0 Then
  sh.Run """" & chrome & """ --profile-directory=""" & profile & """ --new-window """ & url & """", 1, False
Else
  sh.Run url, 1, False
End If
