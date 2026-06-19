' Solo foglio SEC K-8.
Option Explicit
Dim sh, proj, bat
proj = "C:\coding\Biotech_Investment app 6"
bat = proj & "\scripts\Run_Refresh_Profile_Silent.bat"
If MsgBox("Refresh SEC K-8 (15–45 min)." & vbCrLf & "Chiudi il workbook biotech se aperto.", vbOKCancel, "SEC K-8") <> vbOK Then WScript.Quit 0
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = proj
sh.Run """" & bat & """ sec_k8", 1, True
MsgBox "Fine.", vbInformation, "SEC K-8"
