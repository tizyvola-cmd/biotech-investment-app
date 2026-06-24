' Solo foglio Accuracy.
Option Explicit
Dim sh, proj, bat
proj = "C:\coding\Biotech_Investment app 6"
bat = proj & "\scripts\Run_Refresh_Profile_Silent.bat"
If MsgBox("Refresh solo Accuracy." & vbCrLf & "Chiudi il workbook biotech se aperto.", vbOKCancel, "Accuracy") <> vbOK Then WScript.Quit 0
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = proj
sh.Run """" & bat & """ accuracy", 1, True
MsgBox "Fine. Vedi data\refresh_fast_status.txt", vbInformation, "Accuracy"
