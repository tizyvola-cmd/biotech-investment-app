' Doppio clic: refresh fast senza macro Excel (chiudi prima il workbook biotech).
Option Explicit
Dim sh, proj, bat, msg
proj = "C:\coding\Biotech_Investment app 6"
bat = proj & "\scripts\Run_Refresh_Fast_Silent.bat"
If Not CreateObject("Scripting.FileSystemObject").FileExists(bat) Then
    MsgBox "Batch non trovato:" & vbCrLf & bat, vbCritical, "Refresh fast"
    WScript.Quit 1
End If
msg = "Avvio refresh fast." & vbCrLf & vbCrLf & _
    "Chiudi Excel su biotech_orchestrated_output.xlsx prima di OK." & vbCrLf & _
    "Attendi la finestra nera Python (1–5 min)."
If MsgBox(msg, vbOKCancel + vbInformation, "Refresh fast") <> vbOK Then WScript.Quit 0
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = proj
sh.Run """" & bat & """", 1, True
MsgBox "Refresh terminato. Controlla:" & vbCrLf & proj & "\data\refresh_fast_status.txt", _
    vbInformation, "Refresh fast"
