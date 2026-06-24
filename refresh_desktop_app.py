#!/usr/bin/env python3
"""
SuperNova Refresh (legacy Tk) — avvia i profili refresh senza macro Excel.

Evita conflitti con Autosave / OneDrive: il workbook può restare chiuso; se bloccato
il salvataggio va su ``*__staged_<timestamp>.xlsx``.

Uso:
  py -3 refresh_desktop_app.py
  scripts\\Avvia_Refresh_Desktop.bat
"""
from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import DATA_DIR, FINAL_XLSX, LAST_ORCH_LOG
from refresh_fast_status import (
    REFRESH_FAST_STATUS_PATH,
    find_latest_staged_workbook,
)


def _resolve_python() -> str:
    venv = _ROOT / ".venv" / "Scripts" / "python.exe"
    if venv.is_file():
        return str(venv)
    return sys.executable


@dataclass(frozen=True)
class RefreshProfile:
    key: str
    title: str
    detail: str
    eta: str
    argv: tuple[str, ...]
    env_patch: dict[str, str]
    uses_fast_status: bool = True


def is_daily_refresh_fast() -> bool:
    """Profilo feriale veloce (UI / scheduler / ``DAILY_REFRESH_FAST=1``)."""
    return os.environ.get("DAILY_REFRESH_FAST", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def daily_refresh_env_patch() -> dict[str, str]:
    """
    Env refresh giornaliero — target **<30 min** (vs 60–90+ con enrich completo).

    - Simulation: predizioni live + tail-merge prezzi (invariato).
    - Past catalyst: solo righe Simulation passate (no +4k clinical extra / giorno).
    - Accuracy JSON: skip CT.gov su tutto il JSON; HistLib solo se manca seq_curve.
    - Foglio Accuracy: bulk su CD passate; enrich curve solo CD≥oggi; no v5 raw.
    - Merge: no API Yahoo riga-per-riga (``ORCH_SKIP_FINANCIAL_ENRICH``); no SEC K-8 sheet rebuild.
    - Past JSON: solo lettura disco (``PAST_PRED_DISK_ONLY``), no ricalcolo 1469 studi.
    """
    return {
        "PYTHONUNBUFFERED": "1",
        "DAILY_REFRESH_FAST": "1",
        "PRED_CURVE_SEQ_CALIB": "1",
        "SEC_K8_LOOKBACK_DAYS": "180",
        "PRED_K8_DISPLAY_OVERLAY": "1",
        "ACCURACY_SEQ_BLEND_TO_MODEL": "0",
        "SIMULATION_SEQ_BLEND_TO_MODEL": "0",
        "REFRESH_K8_LIVE_FALLBACK": "1",
        "HISTLIB_INCREMENTAL_ONLY": "1",
        "HISTLIB_MIN_LAG_DAYS": "3",
        "HISTLIB_REFRESH_ON_ENRICH": "0",
        "YF_CACHE_STICKY": "1",
        "ORCH_SKIP_LIQUIDITY_YF": "1",
        "PRED_V4_CURVE_SCALE_PRECD": "1.05",
        "PRED_CURVE_APPLY_CAL_FACTOR": "1",
        "ACCURACY_REFRESH_FAST": "1",
        "ACC_SIM_BULK_PAST_WRITE": "1",
        "ACCURACY_V5_RAW_METRICS": "0",
        "PAST_CATALYST_SKIP_CLINICAL_EXTRA": "1",
        "PAST_PRED_DISK_ONLY": "1",
        "ORCH_SKIP_FINANCIAL_ENRICH": "1",
        "ORCH_SKIP_SEC_K8": "1",
        "ORCH_SKIP_OPTIONS_PRED": "1",
        "ACC_SIM_SKIP_V5_ON_WRITE": "1",
        "DAILY_ACCURACY_ENRICH_ACTIVE_ONLY": "1",
        "DAILY_SKIP_ACCURACY_SHEET": "1",
        "SIM_PRESERVE_OUTCOMES": "1",
    }


# Env che attivano la modalità «fast daily» — vanno rimossi prima del WeeklyFull.
DAILY_FAST_ENV_KEYS: tuple[str, ...] = (
    "DAILY_REFRESH_FAST",
    "DAILY_SKIP_ACCURACY_SHEET",
    "DAILY_ACCURACY_ENRICH_ACTIVE_ONLY",
    "PAST_PRED_DISK_ONLY",
    "PAST_CATALYST_SKIP_CLINICAL_EXTRA",
    "ORCH_SKIP_FINANCIAL_ENRICH",
    "ORCH_SKIP_SEC_K8",
    "ORCH_SKIP_OPTIONS_PRED",
    "ORCH_SKIP_LIQUIDITY_YF",
    "ORCH_FAST_RELUNCH",
    "ACCURACY_REFRESH_FAST",
    "ACC_SIM_SKIP_V5_ON_WRITE",
    "ACC_SIM_BULK_PAST_WRITE",
    "ACCURACY_V5_RAW_METRICS",
    "HISTLIB_REFRESH_ON_ENRICH",
)


def strip_daily_fast_env(env: dict[str, str]) -> dict[str, str]:
    """Rimuove flag del refresh feriale veloce (evita contaminazione WeeklyFull)."""
    out = dict(env)
    for key in DAILY_FAST_ENV_KEYS:
        out.pop(key, None)
    return out


def weekly_full_env_patch() -> dict[str, str]:
    """Env orchestrator settimanale — SEC K-8 + enrich completi."""
    return {
        "PYTHONUNBUFFERED": "1",
        "ORCH_SKIP_SEC_K8": "0",
        "ORCH_PERF": "1",
        "HISTLIB_INCREMENTAL_ONLY": "1",
        "HISTLIB_MIN_LAG_DAYS": "3",
        "YF_CACHE_STICKY": "1",
        "YF_QUOTE_REFRESH_HOURS": "4",
        "LIQUIDITY_YF_FORCE": "1",
    }


def accuracy_only_env_patch() -> dict[str, str]:
    """Profilo «Solo Accuracy» — enrich completo foglio Accuracy, no skip feriale."""
    patch = daily_refresh_env_patch()
    patch.pop("DAILY_SKIP_ACCURACY_SHEET", None)
    patch["ACCURACY_REFRESH_FAST"] = "0"
    patch["ACC_SIM_BULK_PAST_WRITE"] = "0"
    patch["ACC_SIM_SKIP_V5_ON_WRITE"] = "0"
    return patch


def _daily_env() -> dict[str, str]:
    return daily_refresh_env_patch()


PROFILES: dict[str, RefreshProfile] = {
    "daily": RefreshProfile(
        "daily",
        "Refresh giornaliero",
        "Simulation (prezzi/curve). Accuracy saltata in feriale — domenica full.",
        "ETA ~8–18 min",
        ("-u", "launch_refresh_fast.py"),
        _daily_env(),
    ),
    "simulation": RefreshProfile(
        "simulation",
        "Solo Simulation",
        "Rigenera Simulation (predizioni, curve nel tempo). Accuracy invariata.",
        "circa 10–25 min",
        ("-u", "launch_refresh_fast.py", "--skip-accuracy"),
        _daily_env(),
    ),
    "accuracy": RefreshProfile(
        "accuracy",
        "Solo Accuracy",
        "Solo foglio Accuracy (Simulation invariata).",
        "circa 10–20 min",
        ("-u", "launch_refresh_fast.py", "--skip-simulation"),
        accuracy_only_env_patch(),
    ),
    "sec_k8": RefreshProfile(
        "sec_k8",
        "Solo SEC 8-K",
        "Foglio filing 8-K (SEC + yfinance).",
        "circa 15–45 min",
        ("-u", "refresh_sec_k8_sheet.py"),
        {"PYTHONUNBUFFERED": "1"},
        uses_fast_status=False,
    ),
    "sunday": RefreshProfile(
        "sunday",
        "Domenica (full)",
        "Orchestrator completo + SEC K-8 + dati.",
        "circa 30–90+ min",
        (),
        weekly_full_env_patch(),
        uses_fast_status=False,
    ),
    "dry_run": RefreshProfile(
        "dry_run",
        "Dry-run",
        "Mostra piano senza scrivere Excel.",
        "pochi secondi",
        ("-u", "launch_refresh_fast.py", "--dry-run"),
        _daily_env(),
    ),
}


def _read_status_file() -> dict[str, str]:
    p = Path(REFRESH_FAST_STATUS_PATH)
    if not p.is_file():
        return {}
    out: dict[str, str] = {}
    try:
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                out[k.strip()] = v.strip()
    except OSError:
        pass
    return out


def _is_workbook_locked(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        with open(path, "a+b"):
            pass
        return False
    except OSError:
        return True


def _find_excel_exe() -> str | None:
    """Percorsi tipici Excel su Windows."""
    for env_key in ("EXCEL_EXE", "BIOTECH_EXCEL_EXE"):
        raw = os.environ.get(env_key, "").strip().strip('"')
        if raw and Path(raw).is_file():
            return raw
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        / "Microsoft Office"
        / "root"
        / "Office16"
        / "EXCEL.EXE",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
        / "Microsoft Office"
        / "root"
        / "Office16"
        / "EXCEL.EXE",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        / "Microsoft Office"
        / "Office16"
        / "EXCEL.EXE",
    ]
    for p in candidates:
        if p.is_file():
            return str(p)
    return None


def _launch_excel_with_workbook(path: Path) -> None:
    """Apre il .xlsx con Excel (associazione Windows o EXCEL.EXE)."""
    if not path.is_file():
        raise FileNotFoundError(f"File non trovato: {path}")
    try:
        os.startfile(str(path))  # type: ignore[attr-defined]
        return
    except OSError:
        pass
    excel = _find_excel_exe()
    if not excel:
        raise FileNotFoundError(
            "Excel non trovato. Imposta EXCEL_EXE nel path dell'eseguibile."
        )
    subprocess.Popen(
        [excel, str(path)],
        cwd=str(path.parent),
        close_fds=True,
    )


class RefreshDesktopApp:
    def __init__(self) -> None:
        import tkinter as tk
        from tkinter import messagebox, scrolledtext, ttk

        self._tk = tk
        self._messagebox = messagebox
        self._scrolledtext = scrolledtext
        self._ttk = ttk

        self._python = _resolve_python()
        self._workbook = Path(FINAL_XLSX)
        self._proc: subprocess.Popen | None = None
        self._log_q: queue.Queue[str | None] = queue.Queue()
        self._poll_after_id: str | None = None

        self.root = tk.Tk()
        self.root.title("SuperNova — Refresh")
        self.root.minsize(720, 520)
        self.root.geometry("860x620")
        for _icon in (
            _ROOT / "refresh_desktop" / "BiotechRefresh.ico",
            _ROOT / "refresh_desktop" / "BiotechRefresh.png",
        ):
            if _icon.exists():
                try:
                    if _icon.suffix.lower() == ".ico":
                        self.root.iconbitmap(str(_icon))
                    else:
                        from tkinter import PhotoImage

                        self.root.iconphoto(True, PhotoImage(file=str(_icon)))
                    break
                except Exception:
                    pass

        self._build_ui()
        self._append_log(
            f"Progetto: {_ROOT}\n"
            f"Python: {self._python}\n"
            f"Workbook: {self._workbook}\n\n"
            "Chiudi Excel sul file dati prima del refresh "
            "(Autosave / OneDrive bloccano il salvataggio).\n"
        )
        self._refresh_status_labels()

    def _build_ui(self) -> None:
        ttk = self._ttk
        root = self.root
        pad = {"padx": 10, "pady": 6}

        top = ttk.Frame(root)
        top.pack(fill="x", **pad)

        ttk.Label(
            top,
            text="Refresh workbook senza macro Excel",
            font=("Segoe UI", 14, "bold"),
        ).pack(anchor="w")

        tips = ttk.Label(
            top,
            text=(
                "Alternativa ad Excel + Autosave: avvia qui, tieni il .xlsx chiuso. "
                "Se il file è bloccato, l’output va in un file "
                "«…__staged_<data>.xlsx» nella cartella data."
            ),
            wraplength=820,
            justify="left",
        )
        tips.pack(anchor="w", pady=(4, 0))

        xl_fr = ttk.LabelFrame(root, text="Excel")
        xl_fr.pack(fill="x", **pad)

        xl_row = ttk.Frame(xl_fr)
        xl_row.pack(fill="x", padx=8, pady=8)

        self._btn_open_excel = ttk.Button(
            xl_row,
            text="Apri workbook in Excel",
            command=self._open_workbook_in_excel,
        )
        self._btn_open_excel.pack(side="left", padx=(0, 8))

        self._btn_open_staged_xl = ttk.Button(
            xl_row,
            text="Apri staged in Excel",
            command=self._open_staged_in_excel,
        )
        self._btn_open_staged_xl.pack(side="left", padx=(0, 8))

        ttk.Label(
            xl_fr,
            text=(
                "Dopo un refresh: chiudi Excel prima di «Giornaliero». "
                "Se esiste uno staged, aprilo per vedere l’ultimo output."
            ),
            wraplength=820,
            justify="left",
        ).pack(anchor="w", padx=8, pady=(0, 8))

        status_fr = ttk.LabelFrame(root, text="Stato")
        status_fr.pack(fill="x", **pad)

        self._lbl_state = ttk.Label(status_fr, text="Stato: —")
        self._lbl_state.pack(anchor="w", padx=8, pady=4)
        self._lbl_wb = ttk.Label(status_fr, text="Workbook: —")
        self._lbl_wb.pack(anchor="w", padx=8, pady=2)
        self._lbl_staged = ttk.Label(status_fr, text="Staged: —")
        self._lbl_staged.pack(anchor="w", padx=8, pady=(2, 6))

        btn_fr = ttk.LabelFrame(root, text="Profili")
        btn_fr.pack(fill="x", **pad)

        grid = ttk.Frame(btn_fr)
        grid.pack(fill="x", padx=8, pady=8)

        specs = [
            ("daily", "Giornaliero", 0, 0),
            ("simulation", "Solo Simulation", 0, 1),
            ("accuracy", "Solo Accuracy", 1, 0),
            ("sec_k8", "SEC 8-K", 1, 1),
            ("sunday", "Domenica full", 2, 0),
            ("dry_run", "Dry-run", 2, 1),
        ]
        for key, label, row, col in specs:
            prof = PROFILES[key]
            b = ttk.Button(
                grid,
                text=f"{label}\n({prof.eta})",
                command=lambda k=key: self._start_profile(k),
            )
            b.grid(row=row, column=col, sticky="ew", padx=4, pady=4)
        for c in range(2):
            grid.columnconfigure(c, weight=1)

        act = ttk.Frame(root)
        act.pack(fill="x", **pad)
        ttk.Button(act, text="Aggiorna stato", command=self._refresh_status_labels).pack(
            side="left", padx=(0, 8)
        )
        ttk.Button(act, text="Apri cartella data", command=self._open_data_dir).pack(
            side="left", padx=(0, 8)
        )
        ttk.Button(act, text="Apri cartella staged", command=self._open_staged_folder).pack(
            side="left", padx=(0, 8)
        )
        ttk.Button(act, text="Interrompi", command=self._stop_job).pack(side="left")

        log_fr = ttk.LabelFrame(root, text="Log")
        log_fr.pack(fill="both", expand=True, **pad)

        self._log = self._scrolledtext.ScrolledText(
            log_fr, height=18, wrap="word", state="disabled", font=("Consolas", 9)
        )
        self._log.pack(fill="both", expand=True, padx=6, pady=6)

    def _append_log(self, text: str) -> None:
        self._log.configure(state="normal")
        self._log.insert("end", text)
        if text and not text.endswith("\n"):
            self._log.insert("end", "\n")
        self._log.see("end")
        self._log.configure(state="disabled")

    def _refresh_status_labels(self) -> None:
        st = _read_status_file()
        locked = _is_workbook_locked(self._workbook)
        staged = find_latest_staged_workbook(str(self._workbook))

        running = self._proc is not None and self._proc.poll() is None
        state = "in corso" if running else (st.get("state") or "—")
        msg = st.get("message") or "—"

        self._lbl_state.configure(
            text=f"Stato: {state} | Job: {'attivo' if running else 'fermo'} | {msg}"
        )
        wb_note = "BLOCCATO (chiudi Excel / pausa Autosave)" if locked else "scrivibile"
        self._lbl_wb.configure(text=f"Workbook: {self._workbook.name} — {wb_note}")
        self._lbl_staged.configure(
            text=f"Staged: {Path(staged).name if staged else '—'}"
        )
        if hasattr(self, "_btn_open_staged_xl"):
            self._btn_open_staged_xl.configure(
                state="normal" if staged else "disabled"
            )

    def _open_workbook_in_excel(self) -> None:
        if not self._workbook.is_file():
            self._messagebox.showerror(
                "Excel",
                f"Workbook non trovato:\n{self._workbook}\n\n"
                "Esegui prima un refresh o verifica il percorso data.",
            )
            return
        try:
            _launch_excel_with_workbook(self._workbook)
            self._append_log(f"Aperto in Excel: {self._workbook}\n")
        except OSError as exc:
            self._messagebox.showerror("Excel", str(exc))

    def _open_staged_in_excel(self) -> None:
        staged = find_latest_staged_workbook(str(self._workbook))
        if not staged:
            self._messagebox.showinfo(
                "Excel",
                "Nessun file staged. Esegui un refresh con il workbook chiuso.",
            )
            return
        try:
            _launch_excel_with_workbook(Path(staged))
            self._append_log(f"Aperto in Excel (staged): {staged}\n")
        except OSError as exc:
            self._messagebox.showerror("Excel", str(exc))

    def _open_data_dir(self) -> None:
        os.makedirs(DATA_DIR, exist_ok=True)
        os.startfile(DATA_DIR)  # type: ignore[attr-defined]

    def _open_staged_folder(self) -> None:
        staged = find_latest_staged_workbook(str(self._workbook))
        if not staged:
            self._messagebox.showinfo(
                "Staged",
                "Nessun file staged trovato. Esegui un refresh con workbook chiuso.",
            )
            return
        os.startfile(str(Path(staged).parent))  # type: ignore[attr-defined]

    def _job_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def _start_profile(self, key: str) -> None:
        if self._job_running():
            self._messagebox.showwarning(
                "Occupato", "Un refresh è già in corso. Attendi o Interrompi."
            )
            return

        prof = PROFILES[key]
        if key != "dry_run" and _is_workbook_locked(self._workbook):
            if not self._messagebox.askyesno(
                "Workbook aperto",
                f"Excel (o OneDrive) tiene bloccato:\n{self._workbook}\n\n"
                "Il salvataggio andrà probabilmente su un file staged.\n"
                "Continuare?",
            ):
                return

        self._append_log(f"\n{'=' * 60}\n▶ {prof.title}\n{prof.detail}\n")

        if key == "sunday":
            self._start_sunday(prof)
        else:
            self._start_python(prof)

        self._schedule_poll()

    def _build_env(self, patch: dict[str, str]) -> dict[str, str]:
        env = os.environ.copy()
        env.update(patch)
        return env

    def _start_python(self, prof: RefreshProfile) -> None:
        cmd = [self._python, *prof.argv]
        log_path = Path(DATA_DIR) / "last_refresh_desktop.log"
        os.makedirs(DATA_DIR, exist_ok=True)
        log_fh = open(log_path, "w", encoding="utf-8")
        self._append_log(f"Comando: {' '.join(cmd)}\n")

        try:
            self._proc = subprocess.Popen(
                cmd,
                cwd=str(_ROOT),
                env=self._build_env(prof.env_patch),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
        except OSError as exc:
            log_fh.close()
            self._messagebox.showerror("Errore", str(exc))
            return

        threading.Thread(
            target=self._reader_thread,
            args=(self._proc, log_fh),
            daemon=True,
        ).start()

    def _start_sunday(self, prof: RefreshProfile) -> None:
        ps1 = _ROOT / "scripts" / "Biotech_Refresh_Profiles.ps1"
        if not ps1.is_file():
            self._messagebox.showerror("Errore", f"Script non trovato: {ps1}")
            return
        cmd = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(ps1),
            "-Profile",
            "WeeklyFull",
        ]
        log_path = Path(LAST_ORCH_LOG)
        self._append_log(f"Comando: {' '.join(cmd)}\n")
        try:
            log_fh = open(log_path, "w", encoding="utf-8")
            self._proc = subprocess.Popen(
                cmd,
                cwd=str(_ROOT),
                env=self._build_env(prof.env_patch),
                stdout=log_fh,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except OSError as exc:
            self._messagebox.showerror("Errore", str(exc))
            return
        threading.Thread(
            target=self._wait_orchestrator_thread,
            args=(log_path, log_fh),
            daemon=True,
        ).start()

    def _reader_thread(self, proc: subprocess.Popen, log_fh) -> None:
        try:
            if proc.stdout:
                for line in proc.stdout:
                    self._log_q.put(line)
            code = proc.wait()
        except Exception as exc:
            self._log_q.put(f"[Errore reader] {exc}\n")
            code = -1
        finally:
            try:
                log_fh.close()
            except Exception:
                pass
        self._log_q.put(None)
        self._log_q.put(f"\n--- Fine processo (exit {code}) ---\n")

    def _wait_orchestrator_thread(self, log_path: Path, log_fh) -> None:
        code = -1
        try:
            if self._proc:
                code = self._proc.wait()
        finally:
            try:
                log_fh.close()
            except Exception:
                pass
        self._log_q.put(None)
        self._log_q.put(f"\n--- Orchestrator fine (exit {code}) ---\n")
        try:
            if log_path.is_file():
                tail = log_path.read_text(encoding="utf-8", errors="replace")
                if tail:
                    self._log_q.put(tail[-8000:])
        except OSError:
            pass

    def _schedule_poll(self) -> None:
        if self._poll_after_id:
            try:
                self.root.after_cancel(self._poll_after_id)
            except Exception:
                pass
        self._poll_after_id = self.root.after(400, self._poll_ui)

    def _poll_ui(self) -> None:
        while True:
            try:
                item = self._log_q.get_nowait()
            except queue.Empty:
                break
            if item is None:
                self._on_job_finished()
                break
            self._append_log(item)

        self._refresh_status_labels()
        if self._job_running():
            self._poll_after_id = self.root.after(400, self._poll_ui)
        else:
            self._poll_after_id = None

    def _on_job_finished(self) -> None:
        self._refresh_status_labels()
        st = _read_status_file()
        staged = st.get("staged_workbook") or find_latest_staged_workbook(
            str(self._workbook)
        )
        ok = st.get("ok") == "1"
        if staged:
            self._append_log(f"File staged: {staged}\n")
            if self._messagebox.askyesno(
                "Completato",
                "Refresh terminato.\n\n"
                f"Output staged:\n{staged}\n\n"
                "Aprire il file staged in Excel?",
            ):
                try:
                    _launch_excel_with_workbook(Path(staged))
                except OSError as exc:
                    self._messagebox.showerror("Excel", str(exc))
        elif ok:
            self._messagebox.showinfo("Completato", st.get("message") or "OK.")
        else:
            self._messagebox.showwarning(
                "Terminato",
                st.get("message") or "Vedi log per errori.",
            )

    def _stop_job(self) -> None:
        if not self._job_running() or not self._proc:
            return
        if not self._messagebox.askyesno(
            "Interrompi", "Terminare il processo in corso?"
        ):
            return
        self._proc.terminate()
        self._append_log("\n[Interrotto dall'utente]\n")

    def run(self) -> None:
        self.root.mainloop()


def main() -> int:
    try:
        RefreshDesktopApp().run()
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
