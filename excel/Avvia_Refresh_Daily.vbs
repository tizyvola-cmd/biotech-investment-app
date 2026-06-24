' Refresh giornaliero — Simulation + Accuracy (preserva P&L).
Option Explicit
Dim sh, proj, bat
proj = "C:\coding\Biotech_Investment app 6"
bat = proj & "\scripts\Run_Refresh_Profile_Silent.bat"
If MsgBox("Refresh giornaliero (Simulation + Accuracy)." & vbCrLf & "Chiudi il workbook biotech se aperto.", vbOKCancel, "Giornaliero") <> vbOK Then WScript.Quit 0
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = proj
sh.Run """" & bat & """ daily", 1, True
MsgBox "Fine. Stato: data\refresh_fast_status.txt", vbInformation, "Giornaliero"
