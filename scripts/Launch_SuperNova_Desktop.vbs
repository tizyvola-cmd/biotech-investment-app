' Avvia SuperNova — usa SuperNova.cmd (affidabile da collegamento Desktop).
Option Explicit
Dim sh, fso, root, launcher, code, cmdLine

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
If Right(root, 7) = "scripts" Then
  root = fso.GetParentFolderName(root)
End If

launcher = root & "\SuperNova.cmd"
If Not fso.FileExists(launcher) Then
  launcher = root & "\scripts\Avvia_Biotech_Desktop.bat"
End If
If Not fso.FileExists(launcher) Then
  MsgBox "File non trovato:" & vbCrLf & root & "\SuperNova.cmd", vbCritical, "SuperNova"
  WScript.Quit 1
End If

sh.CurrentDirectory = root
' 7 = minimizzato (bootstrap); splash Electron mostra il caricamento
cmdLine = "cmd.exe /c " & Chr(34) & launcher & Chr(34)
code = sh.Run(cmdLine, 7, True)
If code <> 0 Then
  WScript.Quit code
End If
