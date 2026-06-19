Attribute VB_Name = "BiotechRefreshMacros"

' Pulsanti refresh nel workbook Biotech (Personal.xlsb o .xlsm).

' Import: File -> Importa -> excel\BiotechRefreshMacros.bas

' Assegna macro da Sviluppatore -> Inserisci -> Pulsante (macro in PERSONAL.XLSB).

'

' Macro pubbliche (una per pulsante):

'   BiotechRefreshDaily      — Simulation + Accuracy (~minuti), preserva P&L

'   BiotechRefreshAccuracy   — solo foglio Accuracy

'   BiotechRefreshSecK8      — solo foglio SEC K-8 (~15–45 min)

'   BiotechRefreshSunday     — orchestrator completo (~30–90+ min)

'   BiotechRefreshFast       — alias di BiotechRefreshDaily (compatibilità)



Option Explicit



Private Const PROJECT_ROOT As String = "C:\coding\Biotech_Investment app 6"

Private Const WORKBOOK_REL As String = "data\biotech_orchestrated_output.xlsx"

Private Const PROFILE_BAT As String = "scripts\Run_Refresh_Profile_Silent.bat"

Private Const STATUS_FILE As String = "data\refresh_fast_status.txt"

Private Const ORCH_LOG As String = "data\last_orchestrator_log.txt"



Public Sub BiotechRefreshFast()

    BiotechRefreshDaily

End Sub



Public Sub BiotechRefreshDaily()

    RunBiotechRefreshProfile "daily", "Refresh giornaliero", _

        "Simulation + Accuracy. Preserva Prezzo acquisto e Capitale.", _

        "1–15 min (tipico).", True

End Sub



Public Sub BiotechRefreshAccuracy()

    RunBiotechRefreshProfile "accuracy", "Refresh Accuracy", _

        "Solo foglio Accuracy (Simulation non modificata).", _

        "pochi minuti.", False

End Sub



Public Sub BiotechRefreshSecK8()

    RunBiotechRefreshProfile "sec_k8", "Refresh SEC K-8", _

        "Solo foglio SEC K-8 (filing 8-K).", _

        "15–45 min.", False

End Sub



Public Sub BiotechRefreshSunday()

    Dim ans As VbMsgBoxResult

    ans = MsgBox( _

        "Orchestrator COMPLETO (domenica)." & vbCrLf & vbCrLf & _

        "• 30–90+ minuti" & vbCrLf & _

        "• Rigenera dati + foglio SEC K-8" & vbCrLf & _

        "• Chiudi Excel sul workbook biotech" & vbCrLf & vbCrLf & _

        "Continuare?", _

        vbYesNo + vbExclamation, "Refresh domenica")

    If ans <> vbYes Then Exit Sub

    RunBiotechRefreshProfile "sunday", "Orchestrator domenica", _

        "Pipeline completa.", "30–90+ min.", True

End Sub



Private Sub RunBiotechRefreshProfile( _

    ByVal profile As String, _

    ByVal title As String, _

    ByVal detail As String, _

    ByVal eta As String, _

    ByVal reopenWorkbook As Boolean)



    Dim wbPath As String

    Dim batPath As String

    Dim statusPath As String

    Dim cmd As String

    Dim shell As Object

    Dim exitCode As Long

    Dim wasOpen As Boolean

    Dim msg As String

    Dim staged As String

    Dim okFlag As String

    Dim useStatus As Boolean



    wbPath = PROJECT_ROOT & "\" & WORKBOOK_REL

    batPath = PROJECT_ROOT & "\" & PROFILE_BAT

    statusPath = PROJECT_ROOT & "\" & STATUS_FILE

    useStatus = (LCase$(profile) = "daily" Or LCase$(profile) = "fast" Or LCase$(profile) = "accuracy")



    If Dir(batPath) = "" Then

        MsgBox "Batch non trovato:" & vbCrLf & batPath, vbCritical, title

        Exit Sub

    End If

    If Dir(wbPath) = "" Then

        MsgBox "Workbook non trovato:" & vbCrLf & wbPath, vbCritical, title

        Exit Sub

    End If



    If useStatus And RefreshIsRunning(statusPath) Then

        MsgBox "Un refresh è già in corso. Attendi o cancella:" & vbCrLf & statusPath, _

            vbExclamation, title

        Exit Sub

    End If



    wasOpen = RefreshCloseWorkbookIfOpen(wbPath)

    MsgBox title & vbCrLf & detail & vbCrLf & vbCrLf & _

        "Tempo: " & eta & vbCrLf & _

        "Non chiudere la finestra Python.", vbInformation, title



    Application.StatusBar = title & " in corso…"

    Application.ScreenUpdating = False

    Application.DisplayAlerts = False



    cmd = """" & batPath & """ " & profile

    Set shell = CreateObject("WScript.Shell")

    exitCode = shell.Run(cmd, 1, True)



    Application.StatusBar = False

    Application.DisplayAlerts = True

    Application.ScreenUpdating = True



    If useStatus Then

        RefreshReadStatus statusPath, okFlag, msg, staged

    Else

        okFlag = IIf(exitCode = 0, "1", "0")

        msg = "Processo terminato (codice " & exitCode & ")."

        If LCase$(profile) = "sunday" Then

            msg = msg & vbCrLf & "Log: " & PROJECT_ROOT & "\" & ORCH_LOG

        End If

        staged = ""

    End If



    If exitCode <> 0 And okFlag <> "1" Then

        msg = "Codice " & exitCode & "." & vbCrLf & msg

    End If



    If staged <> "" Then

        msg = msg & vbCrLf & vbCrLf & "Output STAGED (Excel aveva il file aperto):" & vbCrLf & staged

    ElseIf okFlag = "1" And reopenWorkbook Then

        Workbooks.Open wbPath

        msg = msg & vbCrLf & vbCrLf & "Workbook riaperto."

    ElseIf wasOpen And reopenWorkbook Then

        msg = msg & vbCrLf & vbCrLf & "Riapri:" & vbCrLf & wbPath

    End If



    MsgBox msg, IIf(okFlag = "1", vbInformation, vbExclamation), title

End Sub



Private Function RefreshIsRunning(statusPath As String) As Boolean

    Dim state As String

    If Dir(statusPath) = "" Then Exit Function

    state = LCase$(RefreshStatusValue(statusPath, "state"))

    If state <> "running" Then Exit Function

    If RefreshStatusStaleMinutes(statusPath) > 45 Then

        RefreshIsRunning = False

        Exit Function

    End If

    RefreshIsRunning = True

End Function



Private Function RefreshStatusStaleMinutes(ByVal path As String) As Long

    On Error GoTo Fail

    RefreshStatusStaleMinutes = DateDiff("n", FileDateTime(path), Now)

    Exit Function

Fail:

    RefreshStatusStaleMinutes = 9999

End Function



Private Function RefreshCloseWorkbookIfOpen(wbPath As String) As Boolean

    Dim wb As Workbook

    Dim target As String

    target = LCase$(wbPath)

    RefreshCloseWorkbookIfOpen = False

    For Each wb In Application.Workbooks

        If LCase$(wb.FullName) = target Then

            wb.Close SaveChanges:=True

            RefreshCloseWorkbookIfOpen = True

            Exit Function

        End If

    Next wb

End Function



Private Sub RefreshReadStatus( _

    ByVal statusPath As String, _

    ByRef okFlag As String, _

    ByRef message As String, _

    ByRef staged As String)

    okFlag = ""

    message = "Nessun file di stato."

    staged = ""

    If Dir(statusPath) = "" Then Exit Sub

    okFlag = RefreshStatusValue(statusPath, "ok")

    message = RefreshStatusValue(statusPath, "message")

    staged = RefreshStatusValue(statusPath, "staged_workbook")

End Sub



Private Function RefreshStatusValue(ByVal path As String, ByVal key As String) As String

    Dim fh As Integer

    Dim line As String

    Dim prefix As String

    prefix = key & "="

    fh = FreeFile

    Open path For Input As #fh

    Do While Not EOF(fh)

        Line Input #fh, line

        If Left$(line, Len(prefix)) = prefix Then

            RefreshStatusValue = Mid$(line, Len(prefix) + 1)

            Close #fh

            Exit Function

        End If

    Loop

    Close #fh

    RefreshStatusValue = ""

End Function

