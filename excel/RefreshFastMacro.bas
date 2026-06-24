Attribute VB_Name = "RefreshFastMacro"
' Refresh rapido Biotech Investment — Simulation + Accuracy (preserva P&L).
' Importare in Personal.xlsb o nel workbook .xlsm.
'
' Prima esecuzione: aggiornare PROJECT_ROOT se il progetto non è in C:\coding\...

Option Explicit

Private Const PROJECT_ROOT As String = "C:\coding\Biotech_Investment app 6"
Private Const WORKBOOK_REL As String = "data\biotech_orchestrated_output.xlsx"
Private Const SILENT_BAT As String = "scripts\Run_Refresh_Fast_Silent.bat"
Private Const STATUS_FILE As String = "data\refresh_fast_status.txt"

Public Sub BiotechRefreshFast()
    Dim wbPath As String
    Dim batPath As String
    Dim statusPath As String
    Dim shell As Object
    Dim exitCode As Long
    Dim wasOpen As Boolean
    Dim msg As String
    Dim staged As String
    Dim okFlag As String

    wbPath = PROJECT_ROOT & "\" & WORKBOOK_REL
    batPath = PROJECT_ROOT & "\" & SILENT_BAT
    statusPath = PROJECT_ROOT & "\" & STATUS_FILE

    If Dir(batPath) = "" Then
        MsgBox "Batch non trovato:" & vbCrLf & batPath, vbCritical, "Refresh fast"
        Exit Sub
    End If
    If Dir(wbPath) = "" Then
        MsgBox "Workbook non trovato:" & vbCrLf & wbPath, vbCritical, "Refresh fast"
        Exit Sub
    End If

    If RefreshFastIsRunning(statusPath) Then
        MsgBox "Un refresh è già in corso. Attendi il termine." & vbCrLf & _
            "Se è bloccato da ore, cancella:" & vbCrLf & statusPath, _
            vbExclamation, "Refresh fast"
        Exit Sub
    End If

    wasOpen = RefreshFastCloseWorkbookIfOpen(wbPath)
    MsgBox "Avvio refresh (1–5 min)." & vbCrLf & vbCrLf & _
        "• Si apre una finestra nera (Python): non chiuderla." & vbCrLf & _
        "• Excel può restare vuoto: il file biotech è stato chiuso apposta." & vbCrLf & _
        "• Se resta bloccato >10 min, controlla la finestra Python.", _
        vbInformation, "Refresh fast"

    Application.StatusBar = "Refresh fast in corso… (vedi finestra Python)"
    Application.ScreenUpdating = False
    Application.DisplayAlerts = False

    Set shell = CreateObject("WScript.Shell")
    exitCode = shell.Run("""" & batPath & """", 1, True)

    Application.StatusBar = False
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True

    RefreshFastReadStatus statusPath, okFlag, msg, staged

    If exitCode <> 0 And okFlag <> "1" Then
        msg = "Processo terminato con codice " & exitCode & "." & vbCrLf & msg
    End If

    If staged <> "" Then
        msg = msg & vbCrLf & vbCrLf & _
            "Excel aveva il file aperto: output su STAGED." & vbCrLf & _
            "Sostituisci manualmente il file principale oppure apri:" & vbCrLf & staged
    ElseIf okFlag = "1" Then
        Workbooks.Open wbPath
        msg = msg & vbCrLf & vbCrLf & "Workbook riaperto."
    ElseIf wasOpen Then
        msg = msg & vbCrLf & vbCrLf & "Riapri manualmente:" & vbCrLf & wbPath
    End If

    MsgBox msg, IIf(okFlag = "1", vbInformation, vbExclamation), "Refresh fast"
End Sub

Private Function RefreshFastIsRunning(statusPath As String) As Boolean
    Dim state As String
    If Dir(statusPath) = "" Then Exit Function
    state = LCase$(RefreshFastStatusValue(statusPath, "state"))
    If state <> "running" Then Exit Function
    ' Stale running > 45 min: consenti nuovo run (processo Python morto)
    If RefreshFastStatusStaleMinutes(statusPath) > 45 Then
        RefreshFastIsRunning = False
        Exit Function
    End If
    RefreshFastIsRunning = True
End Function

Private Function RefreshFastStatusStaleMinutes(ByVal path As String) As Long
    On Error GoTo Fail
    RefreshFastStatusStaleMinutes = DateDiff("n", FileDateTime(path), Now)
    Exit Function
Fail:
    RefreshFastStatusStaleMinutes = 9999
End Function

Private Function RefreshFastCloseWorkbookIfOpen(wbPath As String) As Boolean
    Dim wb As Workbook
    Dim target As String
    target = LCase$(wbPath)
    RefreshFastCloseWorkbookIfOpen = False
    For Each wb In Application.Workbooks
        If LCase$(wb.FullName) = target Then
            wb.Close SaveChanges:=True
            RefreshFastCloseWorkbookIfOpen = True
            Exit Function
        End If
    Next wb
End Function

Private Sub RefreshFastReadStatus( _
    ByVal statusPath As String, _
    ByRef okFlag As String, _
    ByRef message As String, _
    ByRef staged As String)
    okFlag = ""
    message = "Nessun file di stato."
    staged = ""
    If Dir(statusPath) = "" Then Exit Sub
    okFlag = RefreshFastStatusValue(statusPath, "ok")
    message = RefreshFastStatusValue(statusPath, "message")
    staged = RefreshFastStatusValue(statusPath, "staged_workbook")
End Sub

Private Function RefreshFastStatusValue(ByVal path As String, ByVal key As String) As String
    Dim fh As Integer
    Dim line As String
    Dim prefix As String
    prefix = key & "="
    fh = FreeFile
    Open path For Input As #fh
    Do While Not EOF(fh)
        Line Input #fh, line
        If Left$(line, Len(prefix)) = prefix Then
            RefreshFastStatusValue = Mid$(line, Len(prefix) + 1)
            Close #fh
            Exit Function
        End If
    Loop
    Close #fh
    RefreshFastStatusValue = ""
End Function
