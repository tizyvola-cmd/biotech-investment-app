' Launcher Desktop — delega a SuperNova.cmd (consigliato: scripts\Installa_Refresh_Su_Desktop.bat).
Option Explicit
Dim sh, fso, root, launcher, cmdLine

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

launcher = root & "\SuperNova.cmd"
If Not fso.FileExists(launcher) Then
  launcher = root & "\scripts\Launch-SuperNova.bat"
End If
If Not fso.FileExists(launcher) Then
  MsgBox "File mancante: SuperNova.cmd", vbCritical, "SuperNova"
  WScript.Quit 1
End If

sh.CurrentDirectory = root
If LCase(Right(launcher, 4)) = ".cmd" Or LCase(Right(launcher, 4)) = ".bat" Then
  cmdLine = "cmd.exe /c " & Chr(34) & launcher & Chr(34)
  sh.Run cmdLine, 7, False
Else
  sh.Run Chr(34) & launcher & Chr(34), 7, False
End If
