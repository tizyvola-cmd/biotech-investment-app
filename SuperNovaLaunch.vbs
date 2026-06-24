' Avvio Desktop SuperNova — finestra nascosta (0), nessun terminale visibile.
Option Explicit
Dim sh, fso, root, launcher, code, cmdLine

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

launcher = root & "\scripts\Launch-SuperNova.bat"
If Not fso.FileExists(launcher) Then
  MsgBox "File mancante:" & vbCrLf & launcher, vbCritical, "SuperNova"
  WScript.Quit 1
End If

sh.CurrentDirectory = root
cmdLine = "cmd.exe /c " & Chr(34) & launcher & Chr(34)
code = sh.Run(cmdLine, 0, True)
If code <> 0 Then
  WScript.Quit code
End If
