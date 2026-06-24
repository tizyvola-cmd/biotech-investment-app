' Orchestrator completo (domenica) — molto lungo.
Option Explicit
Dim sh, proj, bat
proj = "C:\coding\Biotech_Investment app 6"
bat = proj & "\scripts\Run_Refresh_Profile_Silent.bat"
If MsgBox("Orchestrator COMPLETO (30–90+ min)." & vbCrLf & "Chiudi Excel sul workbook biotech.", vbOKCancel + vbExclamation, "Domenica") <> vbOK Then WScript.Quit 0
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = proj
sh.Run """" & bat & """ sunday", 1, True
MsgBox "Fine. Log: data\last_orchestrator_log.txt", vbInformation, "Domenica"
