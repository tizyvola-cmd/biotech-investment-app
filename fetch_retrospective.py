"""
fetch_retrospective.py
----------------------
Fetcher retrospettivo per dati storici biotech.

MODALITÀ 1 — STANDALONE (verifica rapida, non richiede l'orchestrator):
    python fetch_retrospective.py --standalone

    Legge i ticker da retrospective_config.json: ``benchmark_tickers`` (big pharma,
    es. LLY/PFE/AZN) + ``tickers`` (biotech da confrontare; limite ``studio_max_watchlist``),
    scarica la storia prezzi da yfinance e genera un file di anteprima:
        data/studio_preview.xlsx
            → Sheet "Riepilogo IPO"    : metriche dall'IPO a oggi
            → Sheet "Impatto Clinici"  : vuoto (nessun dato clinico disponibile)
            → Sheet "Studio"           : grafico + variazioni + impatto clinici

MODALITÀ 2 — ORCHESTRATOR (aggiunge sheet al file principale):
    python fetch_retrospective.py
    python fetch_retrospective.py --window 60     # finestra ±60 gg (default 30)

    Richiede che data_orchestrator.py sia già stato eseguito.
    Aggiunge/aggiorna i sheet nel workbook orchestrato (``orchestrator_io_paths.FINAL_XLSX``):
            → Sheet "Riepilogo IPO"
            → Sheet "Impatto Clinici"
            → Sheet "Studio"

Lista titoli: foglio Excel **«Studio watchlist»** (consigliato) oppure
``retrospective_config.json``. Refresh rapido: ``--studio-only``.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import math
import os
import sys
import time
from datetime import date, timedelta

import numpy as np
import pandas as pd
import yfinance as yf
from openpyxl import Workbook, load_workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import ColorScaleRule

# Console Windows spesso usa cp1252: evita crash sui caratteri Unicode nei log.
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(errors="replace")
except Exception:
    pass

import builtins as _builtins


def _safe_print(*args, **kwargs):
    try:
        _builtins.print(*args, **kwargs)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "cp1252"
        safe = tuple(
            s.encode(enc, errors="replace").decode(enc, errors="replace")
            if isinstance(s, str) else s
            for s in args
        )
        _builtins.print(*safe, **kwargs)


print = _safe_print

# ── Configurazione percorsi ───────────────────────────────────────────────────
from orchestrator_io_paths import (
    DATA_DIR,
    FINAL_JSON as INPUT_JSON,
    FINAL_XLSX as OUTPUT_EXCEL,
    RETROSPECTIVE_CONFIG_JSON,
)

STANDALONE_EXCEL = os.path.join(DATA_DIR, "studio_preview.xlsx")
CACHE_DIR        = os.path.join(DATA_DIR, "retro_cache")   # cache storico prezzi + info

# Argomenti CLI
parser = argparse.ArgumentParser(description="Retrospective fetcher")
parser.add_argument("--window", type=int, default=30,
                    help="Finestra giorni prima/dopo completion date (default 30)")
parser.add_argument("--standalone", action="store_true",
                    help="Output indipendente in studio_preview.xlsx "
                         "(non richiede l'orchestrator)")
parser.add_argument("--force", action="store_true",
                    help="Ignora la cache su disco e riscarica tutto da zero "
                         "(utile dopo split azionari o corporate actions)")
parser.add_argument(
    "--studio-only",
    action="store_true",
    help="Rigenera solo il foglio Studio leggendo «Studio watchlist» nel workbook "
         "(veloce; con Excel aperto salva un file __staged_*.xlsx).",
)
args, _ = parser.parse_known_args()
WINDOW       = args.window
STANDALONE   = args.standalone
FORCE_CACHE  = args.force
STUDIO_ONLY  = args.studio_only

STUDIO_WATCHLIST_SHEET = "Studio watchlist"
_RETRO_SHEETS_REWRITE = ("Riepilogo IPO", "Impatto Clinici", "Studio", "Previsioni Trial")


def _load_workbook_for_retro(xlsx_path: str, *, read_only: bool = False, data_only: bool = False):
    """``keep_vba`` solo su ``.xlsm`` — su ``.xlsx`` può corrompere il file per Excel."""
    _kv = str(xlsx_path or "").lower().endswith(".xlsm")
    return load_workbook(
        xlsx_path,
        read_only=read_only,
        data_only=data_only,
        keep_vba=_kv,
    )

# Big pharma di riferimento nel foglio Studio (sovrascrivibili in config).
_DEFAULT_STUDIO_BENCHMARK_TICKERS: tuple[str, ...] = ("LLY", "PFE", "AZN")


def load_studio_symbols_from_config(
    config_path: str | None = None,
) -> tuple[list[str], set[str]]:
    """
    Simboli per il foglio **Studio**, in ordine:

    1. ``benchmark_tickers`` (default LLY, PFE, AZN) — confronto con i giganti;
    2. ``tickers`` — watchlist biotech (max ``studio_max_watchlist``, default 12).

    Restituisce ``(symbols_ordinati, benchmark_set)``.
    """
    path = config_path or RETROSPECTIVE_CONFIG_JSON
    if not os.path.isfile(path):
        return [], set()
    try:
        with open(path, encoding="utf-8") as fh:
            cfg = json.load(fh)
    except Exception as exc:
        print(f"  [WARN] load_studio_symbols_from_config: {exc}")
        return [], set()
    if not isinstance(cfg, dict):
        return [], set()

    try:
        max_watch = int(cfg.get("studio_max_watchlist", 12))
    except (TypeError, ValueError):
        max_watch = 12
    max_watch = max(1, min(max_watch, 30))

    def _norm_list(raw) -> list[str]:
        if not isinstance(raw, (list, tuple)):
            return []
        out: list[str] = []
        seen: set[str] = set()
        for t in raw:
            s = str(t).strip().upper()
            if s and s not in seen:
                seen.add(s)
                out.append(s)
        return out

    bench = _norm_list(cfg.get("benchmark_tickers"))
    if not bench:
        bench = list(_DEFAULT_STUDIO_BENCHMARK_TICKERS)
    watch = _norm_list(cfg.get("tickers"))[:max_watch]

    bench_set = set(bench)
    ordered: list[str] = []
    seen_all: set[str] = set()
    for s in bench + watch:
        if s not in seen_all:
            seen_all.add(s)
            ordered.append(s)
    return ordered, bench_set


def _studio_benchmark_flag(cell_value) -> bool:
    s = str(cell_value or "").strip().upper()
    return s in (
        "S",
        "SI",
        "SÌ",
        "S\u00cc",
        "YES",
        "Y",
        "1",
        "TRUE",
        "BENCH",
        "BENCHMARK",
        "★",
        "*",
        "X",
    )


def read_studio_watchlist_from_worksheet(ws) -> tuple[list[str], set[str]]:
    """
    Legge il foglio «Studio watchlist» (col. A ticker, B benchmark S/N, C nota).
    Righe dati dalla 4 in giù.
    """
    ordered: list[str] = []
    bench_set: set[str] = set()
    seen: set[str] = set()
    for row_idx in range(4, (ws.max_row or 0) + 1):
        raw = ws.cell(row=row_idx, column=1).value
        if raw is None:
            continue
        sym = str(raw).strip().upper().replace("$", "")
        if not sym or sym in ("—", "-", "TICKER", "TICKER "):
            continue
        if sym in seen:
            continue
        seen.add(sym)
        ordered.append(sym)
        if _studio_benchmark_flag(ws.cell(row=row_idx, column=2).value):
            bench_set.add(sym)
    # Benchmark prima, poi watchlist (stesso ordine del foglio per pari gruppo)
    bench_ordered = [s for s in ordered if s in bench_set]
    watch_ordered = [s for s in ordered if s not in bench_set]
    return bench_ordered + watch_ordered, bench_set


def read_studio_watchlist_from_workbook(
    workbook_path: str,
    *,
    read_only: bool = False,
) -> tuple[list[str], set[str]]:
    if not workbook_path or not os.path.isfile(workbook_path):
        return [], set()
    try:
        wb = _load_workbook_for_retro(workbook_path, read_only=read_only, data_only=True)
    except PermissionError:
        print(
            f"  [Studio watchlist] Impossibile aprire {workbook_path} — "
            "chiudi Excel o usa il file __staged_*.xlsx dopo un refresh precedente.",
            flush=True,
        )
        return [], set()
    except Exception as exc:
        print(f"  [Studio watchlist] Lettura workbook: {exc}", flush=True)
        return [], set()
    try:
        if STUDIO_WATCHLIST_SHEET not in wb.sheetnames:
            return [], set()
        return read_studio_watchlist_from_worksheet(wb[STUDIO_WATCHLIST_SHEET])
    finally:
        wb.close()


def write_studio_watchlist_sheet(wb: Workbook, *, seed_if_empty: bool = True) -> None:
    """
    Crea il foglio «Studio watchlist» se manca (non sovrascrive righe esistenti).
    """
    if STUDIO_WATCHLIST_SHEET in wb.sheetnames:
        return
    ws = wb.create_sheet(STUDIO_WATCHLIST_SHEET, 0)
    ws.sheet_properties.tabColor = "5C6BC0"
    ws.merge_cells("A1:C1")
    c1 = ws["A1"]
    c1.value = "Studio — lista titoli (modifica qui, poi refresh)"
    c1.font = Font(bold=True, color="FFFFFF", size=12)
    c1.fill = PatternFill("solid", fgColor="3949AB")
    c1.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 24
    ws.merge_cells("A2:C2")
    ws["A2"].value = (
        "Colonna A = ticker US.  B = S se benchmark (LLY/PFE/AZN…).  "
        "Poi: python fetch_retrospective.py --studio-only  "
        "(Excel può restare aperto → si crea biotech_orchestrated_output__staged_*.xlsx)."
    )
    ws["A2"].font = Font(italic=True, size=9, color="333333")
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[2].height = 36
    for col, hdr, w in (
        (1, "Ticker", 12),
        (2, "Benchmark\n(S/N)", 11),
        (3, "Nota (opz.)", 28),
    ):
        hc = ws.cell(row=3, column=col, value=hdr)
        hc.font = HEADER_FONT
        hc.fill = HEADER_FILL
        hc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(col)].width = w
    ws.row_dimensions[3].height = 28
    if seed_if_empty:
        for ri, (sym, bench, note) in enumerate(
            (
                ("LLY", "S", "Eli Lilly"),
                ("PFE", "S", "Pfizer"),
                ("AZN", "S", "AstraZeneca"),
                ("MRNA", "N", ""),
                ("HURA", "N", "TuHURA"),
            ),
            start=4,
        ):
            ws.cell(row=ri, column=1, value=sym).font = Font(bold=True, size=10)
            ws.cell(row=ri, column=2, value=bench).alignment = Alignment(horizontal="center")
            ws.cell(row=ri, column=3, value=note)
    ws.freeze_panes = "A4"


def load_studio_symbols(
    workbook_path: str | None = None,
    config_path: str | None = None,
) -> tuple[list[str], set[str]]:
    """
    Priorità: foglio Excel «Studio watchlist» se ha almeno un ticker;
    altrimenti ``retrospective_config.json``.
    """
    wb_path = workbook_path
    if wb_path and os.path.isfile(wb_path):
        sym, bench = read_studio_watchlist_from_workbook(wb_path)
        if sym:
            print(
                f"[Studio] {len(sym)} ticker da foglio «{STUDIO_WATCHLIST_SHEET}» "
                f"(benchmark: {', '.join(sorted(bench)) or '—'})",
                flush=True,
            )
            return sym, bench
    sym, bench = load_studio_symbols_from_config(config_path)
    if sym:
        print("[Studio] Ticker da retrospective_config.json (nessuna riga in watchlist)", flush=True)
    return sym, bench


def _save_workbook_staged(wb: Workbook, xlsx_path: str, *, log_label: str = "[Retro]") -> str:
    """Salva il workbook; se il file è aperto in Excel usa ``__staged_<timestamp>.xlsx``."""
    import tempfile

    from data_orchestrator import _orch_commit_xlsx_replace_or_stage

    out_dir = os.path.dirname(os.path.abspath(xlsx_path)) or "."
    fd, tmp = tempfile.mkstemp(prefix="~tmp_retro_", suffix=".xlsx", dir=out_dir)
    os.close(fd)
    try:
        wb.save(tmp)
        return _orch_commit_xlsx_replace_or_stage(xlsx_path, tmp, log_label=log_label)
    except Exception:
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except OSError:
            pass
        raise


def refresh_studio_sheet_only(xlsx_path: str, window: int) -> bool:
    """
    Rigenera **solo** «Studio» dalla watchlist Excel (o JSON fallback).
    Non riscrive Riepilogo IPO / Impatto Clinici.
    """
    if not os.path.isfile(xlsx_path):
        print(f"  [ERR] Workbook non trovato: {xlsx_path}")
        return False

    try:
        wb = _load_workbook_for_retro(xlsx_path)
    except PermissionError:
        print(
            f"\n[ERRORE] Impossibile aprire in scrittura:\n  {xlsx_path}\n"
            "  → Chiudi Excel sul file, oppure salva una copia e riesegui.",
        )
        return False

    write_studio_watchlist_sheet(wb)
    studio_tickers, studio_bench = load_studio_symbols(workbook_path=xlsx_path)
    if not studio_tickers:
        print("  [ERR] Nessun ticker — compila il foglio «Studio watchlist» (colonna A).")
        wb.close()
        return False

    print(f"\n[Studio-only] Download prezzi per {len(studio_tickers)} ticker…")
    metrics_list: list[dict] = []
    metrics_map: dict = {}
    for i, sym in enumerate(studio_tickers, start=1):
        print(f"  ({i}/{len(studio_tickers)}) {sym}…", end=" ", flush=True)
        hist = fetch_history_cached(sym, force=FORCE_CACHE)
        if hist.empty:
            print("nessun dato")
            continue
        info = fetch_info_cached(sym, fallback={"longName": sym}, force=FORCE_CACHE)
        m = compute_metrics(sym, hist, info)
        m["n_studies"] = 0
        metrics_list.append(m)
        metrics_map[sym] = m
        print(f"OK  ret={m.get('total_ret', 0):.0f}%")

    impact_rows: list[dict] = []
    if not STANDALONE and os.path.isfile(INPUT_JSON):
        try:
            _fin, clin_df = load_orchestrator()
            print(f"[Studio-only] Impatto clinico (±{window} gg) sui ticker lista…")
            impact_rows = compute_clinical_impact(clin_df, metrics_map, window)
            print(f"  → {len(impact_rows)} righe impatto")
        except Exception as exc:
            print(f"  [WARN] Impatto clinico saltato: {exc}")

    if "Studio" in wb.sheetnames:
        del wb["Studio"]
    write_studio_sheet(
        wb,
        metrics_list,
        impact_rows,
        studio_tickers,
        window,
        studio_benchmarks=studio_bench,
    )

    try:
        out = _save_workbook_staged(wb, xlsx_path, log_label="[Studio-only]")
    finally:
        wb.close()
    print(f"\n✅ Studio aggiornato → {out}")
    return True


# ── Campi da cercare nel clinical df ─────────────────────────────────────────
_DATE_CANDIDATES   = ["primary_completion_date", "completion_date",
                      "PrimaryCompletionDate", "CompletionDate",
                      "estimated_completion_date", "end_date"]
_TITLE_CANDIDATES  = ["brief_title", "BriefTitle", "official_title",
                      "OfficialTitle", "study_title", "title"]
_PHASE_CANDIDATES  = ["phase", "Phase", "study_phase"]
_STATUS_CANDIDATES = ["overall_status", "OverallStatus", "status", "study_status"]
_NAME_CANDIDATES   = ["longName", "shortName", "name", "companyName"]
_SYM_CANDIDATES    = ["symbol", "ticker"]
_PRICE_CANDIDATES  = ["currentPrice_finnhub", "currentPrice", "last_close", "previousClose"]

# ── Stili Excel ───────────────────────────────────────────────────────────────
TITLE_FILL   = PatternFill("solid", fgColor="1F3864")
TITLE_FONT   = Font(bold=True, color="FFFFFF", size=13)
HEADER_FILL  = PatternFill("solid", fgColor="4472C4")
HEADER_FONT  = Font(bold=True, color="FFFFFF", size=10)
DESC_FILL    = PatternFill("solid", fgColor="D9E1F2")
DESC_FONT    = Font(italic=True, color="444444", size=9)
ODD_FILL     = PatternFill("solid", fgColor="FFFFFF")
EVEN_FILL    = PatternFill("solid", fgColor="F2F7FF")
DATA_FONT    = Font(size=10)
POS_FILL     = PatternFill("solid", fgColor="C6EFCE")
POS_FONT     = Font(bold=True, color="375623", size=10)
NEG_FILL     = PatternFill("solid", fgColor="FFC7CE")
NEG_FONT     = Font(bold=True, color="9C0006", size=10)
NA_FONT      = Font(italic=True, color="888888", size=10)
SECT_FILL    = PatternFill("solid", fgColor="BDD7EE")
SECT_FONT    = Font(bold=True, color="1F3864", size=10)
BORDER_THIN  = Border(
    bottom=Side(style="thin", color="B8CCE4"),
    top=Side(style="thin",    color="B8CCE4"),
)
ALIGN_C = Alignment(horizontal="center", vertical="center", wrap_text=False)
ALIGN_L = Alignment(horizontal="left",   vertical="center", wrap_text=False)
ALIGN_R = Alignment(horizontal="right",  vertical="center", wrap_text=False)
WRAP_L  = Alignment(horizontal="left",   vertical="center", wrap_text=True)


# ── Helper functions ──────────────────────────────────────────────────────────

def _pick(candidates, df):
    return next((c for c in candidates if c in df.columns), None)


def _flt(val):
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _pct(new, old):
    if old and old != 0 and new is not None:
        return (new - old) / abs(old) * 100
    return None


def _r2_score(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    ss_res = np.sum((y_true - y_pred) ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    return float(1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0


def _fit_pre_curve(x_pts: list, y_pts: list, p_at: float):
    """
    Fitta i punti (x_pts, y_pts) con modelli: Lineare, Polinomiale°2, Esponenziale.
    Sceglie il modello con R² più alto.

    x_pts : giorni da T (es. [-20, -10, -7, -5, -1, 0])
    y_pts : prezzi corrispondenti (None = dato assente)
    p_at  : prezzo a T (normalizzazione pendenza)

    Ritorna:
        slope_pct  : pendenza a T in %/giorno rispetto a p_at  (None se impossibile)
        model_name : nome modello migliore
        r2         : R² del modello migliore
    """
    # Filtra coppie valide
    pairs = [(x, y) for x, y in zip(x_pts, y_pts)
             if y is not None and y > 0 and x is not None]
    if len(pairs) < 3 or not p_at or p_at <= 0:
        return None, "N/D", None

    x = np.array([p[0] for p in pairs], dtype=float)
    y = np.array([p[1] for p in pairs], dtype=float)

    candidates: dict[str, tuple[float, float]] = {}  # {nome: (r2, slope_at_T)}

    # ── 1. Lineare  y = mx + q ───────────────────────────────────────────────
    try:
        c = np.polyfit(x, y, 1)
        r2 = _r2_score(y, np.polyval(c, x))
        slope = float(c[0])                          # dy/dx costante
        candidates["Lineare"] = (r2, slope)
    except Exception:
        pass

    # ── 2. Polinomiale grado 2  y = ax²+bx+c ────────────────────────────────
    if len(pairs) >= 4:
        try:
            c = np.polyfit(x, y, 2)
            r2 = _r2_score(y, np.polyval(c, x))
            slope = float(2 * c[0] * 0 + c[1])      # derivata in x=0: b
            candidates["Polinomiale°2"] = (r2, slope)
        except Exception:
            pass

    # ── 3. Esponenziale  y = e^(bx+a) ───────────────────────────────────────
    try:
        c = np.polyfit(x, np.log(y), 1)
        b, a = float(c[0]), float(c[1])
        y_pred = np.exp(b * x + a)
        r2 = _r2_score(y, y_pred)
        slope = b * float(np.exp(a))                 # dy/dx a x=0: b·e^a
        candidates["Esponenziale"] = (r2, slope)
    except Exception:
        pass

    if not candidates:
        return None, "N/D", None

    best_name = max(candidates, key=lambda k: candidates[k][0])
    best_r2, best_slope = candidates[best_name]

    # Pendenza normalizzata: %/giorno rispetto al prezzo a T
    slope_pct = (best_slope / p_at) * 100.0

    return slope_pct, best_name, round(best_r2, 3)


# ── Soglie qualità predizione ─────────────────────────────────────────────────
R2_MIN         = 0.45   # R² minimo per fitting affidabile
_SLOPE_STABILE = 0.5    # ±0.5 %/gg → zona troppo ambigua per predire

# ── Soglie dissociazione curva ────────────────────────────────────────────────
_DISS_THRESHOLD_PCT = 3.0   # % deviazione minima per dichiarare dissociazione
_DISS_MAX_DAYS      = 30    # finestra post-T entro cui cercare (gg)
_DISS_PRE_WINDOW    = 45    # sessioni pre-T usate per il fitting estrapolativo


def _fit_extrapolate(close: pd.Series, cd):
    """
    Fitta la curva pre-evento su prezzi giornalieri reali (ultime _DISS_PRE_WINDOW sessioni).
    Ritorna (predict_fn, model_name, r2, std_residuals).
    predict_fn(d) → prezzo previsto per il giorno d relativo a T (T=0).
    """
    cd_ts = pd.Timestamp(cd)
    pre   = close.loc[close.index < cd_ts].tail(_DISS_PRE_WINDOW)
    if len(pre) < 5:
        return None, "N/D", None, None

    x = np.array([(dt - cd_ts).days for dt in pre.index], dtype=float)
    y = pre.values.astype(float)
    if np.any(y <= 0):
        return None, "N/D", None, None

    candidates: dict = {}

    try:
        c = np.polyfit(x, y, 1)
        r2 = _r2_score(y, np.polyval(c, x))
        candidates["Lineare"] = (r2, lambda d, _c=c: float(np.polyval(_c, d)))
    except Exception:
        pass

    if len(x) >= 6:
        try:
            c = np.polyfit(x, y, 2)
            r2 = _r2_score(y, np.polyval(c, x))
            candidates["Polinomiale°2"] = (r2, lambda d, _c=c: float(np.polyval(_c, d)))
        except Exception:
            pass

    try:
        c_log = np.polyfit(x, np.log(y), 1)
        b, a  = float(c_log[0]), float(c_log[1])
        r2    = _r2_score(y, np.exp(b * x + a))
        candidates["Esponenziale"] = (r2, lambda d, _b=b, _a=a: float(np.exp(_b * d + _a)))
    except Exception:
        pass

    if not candidates:
        return None, "N/D", None, None

    best_name = max(candidates, key=lambda k: candidates[k][0])
    best_r2, predict_fn = candidates[best_name]

    if best_r2 < R2_MIN:
        return None, best_name, round(best_r2, 3), None

    y_pred_all = np.array([predict_fn(xi) for xi in x])
    std_res    = float(np.std(y - y_pred_all)) if len(y) > 2 else 0.0
    return predict_fn, best_name, round(best_r2, 3), std_res


def _dissociation_day(close: pd.Series, cd, p_at: float,
                      max_days: int = _DISS_MAX_DAYS) -> str:
    """
    Primo giorno post-T in cui il prezzo reale si discosta dalla curva pre-T
    per più della soglia adattiva max(3%, 1.5×σ residui normalizzati).

    Ritorna "D+N", ">30gg" (nessuna dissociazione), "—" (evento futuro),
    "N/D" (dati o fitting insufficienti).
    """
    if cd >= date.today():
        return "—"
    if p_at is None or p_at <= 0:
        return "N/D"

    predict_fn, _, r2, std_res = _fit_extrapolate(close, cd)
    if predict_fn is None:
        return "N/D"

    norm_std      = (std_res / p_at * 100.0) if (std_res and p_at > 0) else 0.0
    threshold_pct = max(_DISS_THRESHOLD_PCT, 1.5 * norm_std)

    cd_ts    = pd.Timestamp(cd)
    post_end = cd_ts + timedelta(days=max_days + 15)
    post     = close.loc[(close.index > cd_ts) & (close.index <= post_end)]
    if post.empty:
        return "—"

    for dt, actual in post.items():
        d = int((dt - cd_ts).days)
        if d > max_days:
            break
        try:
            predicted = predict_fn(d)
        except Exception:
            continue
        if predicted and predicted > 0:
            dev_pct = abs(float(actual) - predicted) / predicted * 100.0
            if dev_pct > threshold_pct:
                return f"D+{d}"

    return f">{max_days}gg"


# ── Nuovi helper: XBI market-adjusted, volume build-up ────────────────────────

_XBI_TICKER = "^XBI"   # SPDR S&P Biotech ETF — proxy settoriale


def _fetch_xbi_close(force: bool = False) -> pd.Series:
    """
    Scarica e carica dalla cache la serie prezzi di chiusura dell'ETF XBI.
    Ritorna pd.Series con DatetimeIndex tz-naive, o serie vuota se non disponibile.
    """
    try:
        # Sanitizza il ticker per il nome del file cache (^ non è portabile ovunque)
        safe_sym = _XBI_TICKER.replace("^", "_")
        cache_file = os.path.join(CACHE_DIR, f"{safe_sym}.pkl")
        os.makedirs(CACHE_DIR, exist_ok=True)

        import pickle as _pkl
        cached = None
        if not force and os.path.exists(cache_file):
            try:
                with open(cache_file, "rb") as _f:
                    cached = _pkl.load(_f)
            except Exception:
                cached = None

        if cached is not None and not cached.empty:
            hist = cached
        else:
            print(f"  [retro] Download {_XBI_TICKER} da yfinance...")
            import yfinance as _yf
            tk   = _yf.Ticker(_XBI_TICKER)
            # "max" non supportato per tutti i ticker — usa start date
            try:
                hist = tk.history(start="2005-01-01", auto_adjust=True)
            except Exception:
                hist = tk.history(period="10y", auto_adjust=True)
            hist.index = pd.to_datetime(hist.index).tz_localize(None)
            if not hist.empty:
                with open(cache_file, "wb") as _f:
                    _pkl.dump(hist, _f)

        if hist.empty or "Close" not in hist.columns:
            print(f"  [retro] WARN: {_XBI_TICKER} — nessun dato disponibile")
            return pd.Series(dtype=float)

        cl = hist["Close"].copy()
        cl.index = pd.to_datetime(cl.index).tz_localize(None)
        print(f"  [retro] XBI: {len(cl)} sessioni ({cl.index[0].date()} → {cl.index[-1].date()})")
        return cl
    except Exception as e:
        print(f"  [retro] WARN: download XBI fallito — {e}")
        return pd.Series(dtype=float)


def _market_excess_slope(close: pd.Series, cd, xbi_close: pd.Series,
                          pre_window: int = 45) -> float | None:
    """
    Pendenza del titolo al netto del mercato biotech (XBI).
    excess_slope = (ret_stock - ret_xbi) / n_trading_days_pre  [%/gg]

    Un valore positivo significa che il titolo stava sovra-performando il settore
    già prima del completion date → segnale specifico del trial.
    """
    if xbi_close is None or xbi_close.empty:
        return None
    cd_ts     = pd.Timestamp(cd)
    pre_stock = close.loc[close.index < cd_ts].tail(pre_window)
    pre_xbi   = xbi_close.loc[xbi_close.index < cd_ts].tail(pre_window)
    if len(pre_stock) < 5 or len(pre_xbi) < 5:
        return None
    p0s = float(pre_stock.iloc[0])
    p1s = float(pre_stock.iloc[-1])
    p0x = float(pre_xbi.iloc[0])
    p1x = float(pre_xbi.iloc[-1])
    if p0s <= 0 or p0x <= 0:
        return None
    ret_s   = (p1s / p0s - 1.0) * 100.0
    ret_x   = (p1x / p0x - 1.0) * 100.0
    n_days  = max(len(pre_stock), 1)
    return round((ret_s - ret_x) / n_days, 3)


def _volume_ratio_pre(volume: pd.Series, cd,
                       signal_days: int = 5, pre_window: int = 20) -> float | None:
    """
    Rapporto volume medio negli ultimi signal_days pre-T
    rispetto alla media delle sessioni precedenti (T-pre_window … T-signal_days).
    > 1.5 = build-up (segnale forte), < 0.7 = volume in calo (segnale debole).
    """
    if volume is None or volume.empty:
        return None
    cd_ts = pd.Timestamp(cd)
    pre   = volume.loc[volume.index < cd_ts].tail(pre_window)
    if len(pre) < signal_days + 3:
        return None
    avg_signal = float(pre.tail(signal_days).mean())
    avg_base   = float(pre.iloc[:-signal_days].mean())
    if avg_base <= 0:
        return None
    return round(avg_signal / avg_base, 2)


def _rsi_at_t(close: pd.Series, cd, pre_window: int = 60,
              period: int = 14) -> float | None:
    """
    RSI-14 calcolato sull'ultimo giorno disponibile prima di T.
    Usa EWM (Wilder smoothing) per massima fedeltà al calcolo standard.
    Ritorna None se la serie è troppo corta.
    """
    try:
        if close is None:
            return None
        # Alcuni provider possono restituire DataFrame multi-colonna o dtype non numerici.
        # Qui normalizziamo sempre a Series numerica per evitare errori su operazioni +/-.
        if isinstance(close, pd.DataFrame):
            if "Close" in close.columns:
                cl = close["Close"].copy()
            else:
                _num_cols = list(close.select_dtypes(include=["number"]).columns)
                if not _num_cols:
                    return None
                cl = close[_num_cols[0]].copy()
        else:
            cl = close.copy()

        cl = pd.to_numeric(cl, errors="coerce").dropna()
        if cl.empty:
            return None
        _idx = pd.to_datetime(cl.index, errors="coerce", utc=True)
        _ok = ~pd.isna(_idx)
        if not bool(_ok.any()):
            return None
        cl = cl.loc[_ok]
        _idx = _idx[_ok].tz_convert(None)
        cl.index = _idx
        cl = cl.sort_index()

        t_dt = pd.Timestamp(cd)
        if getattr(t_dt, "tzinfo", None) is not None:
            t_dt = t_dt.tz_convert(None)
        pre  = cl[cl.index <= t_dt].tail(pre_window)
        if len(pre) < period + 5:
            return None
        delta    = pre.diff().dropna()
        if delta.empty:
            return None
        gain     = delta.clip(lower=0)
        # Evita unary minus su dtype datetimelike: usa clip+abs in modo robusto.
        loss     = delta.clip(upper=0).abs()
        avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
        avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
        rs       = avg_gain / avg_loss.replace(0, float("nan"))
        rsi_s    = 100.0 - (100.0 / (1.0 + rs))
        val      = float(rsi_s.iloc[-1])
        return round(val, 1) if not pd.isna(val) else None
    except Exception:
        return None


def _apply_pred_adj(pred: str, rsi: float | None,
                    ret_pre: float | None,
                    vol_ratio: float | None = None) -> tuple[str, list[str]]:
    """
    Corregge la predizione grezza per bias documentati in biotech:
      1. Buy-the-rumor (soglia abbassata a +15%):
           - ret_pre > +30%  OPPURE  (ret_pre > +15% E vol_ratio > 1.5)
             → downgrade DOPPIO (può arrivare fino a ↓ Calo lieve)
           - ret_pre > +15%  OPPURE  vol_ratio > 1.5  (singolo segnale)
             → downgrade SINGOLO
         Razionale: in biotech il rialzo pre-trial incorpora già le aspettative
         positive; quando c'è anche build-up di volume il denaro è già entrato
         → sell-the-news quasi certo.
      2. RSI overbought > 70  → momentum esaurito, downgrade rialzista
      3. RSI oversold   < 30  → eccesso di pessimismo, upgrade ribassista

    Ritorna (predizione_corretta, lista_motivazioni_correzione).
    """
    _LADDER = [
        "↑↑ Forte crescita",
        "↑ Crescita lieve",
        "→ Stabile",
        "↓ Calo lieve",
        "↓↓ Calo forte",
    ]

    def _dn(p: str, steps: int = 1) -> str:
        try:
            return _LADDER[min(_LADDER.index(p) + steps, len(_LADDER) - 1)]
        except ValueError:
            return p

    def _up(p: str, steps: int = 1) -> str:
        try:
            return _LADDER[max(_LADDER.index(p) - steps, 0)]
        except ValueError:
            return p

    adj     = pred
    reasons: list[str] = []

    _btr_strong   = (ret_pre is not None and ret_pre > 30.0)
    _btr_moderate = (ret_pre is not None and ret_pre > 15.0)
    _vol_high     = (vol_ratio is not None and vol_ratio > 1.5)

    # 1. Buy-the-rumor / sell-the-news (solo per predizioni rialziste)
    # Massimo 1 step: evita che ↑ → → Stabile (verrebbe poi filtrato come N/D
    # e uscirebbe dal denominatore dell'accuratezza anziché essere contato come ↓).
    if adj in ("↑↑ Forte crescita", "↑ Crescita lieve"):
        if _btr_moderate or _vol_high:
            new = _dn(adj, 1)
            if _btr_strong:
                tag = f"ret_pre={ret_pre:.1f}%>+30%"
            elif _btr_moderate and _vol_high:
                tag = f"ret_pre={ret_pre:.1f}%>+15% + vol×{vol_ratio:.1f}>1.5"
            elif _btr_moderate:
                tag = f"ret_pre={ret_pre:.1f}%>+15%"
            else:
                tag = f"vol×{vol_ratio:.1f}>1.5"
            reasons.append(f"Buy-the-rumor [{tag}]: {adj} ↘ {new}")
            adj = new

    # 2. RSI overbought (agisce dopo buy-the-rumor)
    if rsi is not None and rsi > 70.0 and adj in ("↑↑ Forte crescita", "↑ Crescita lieve"):
        new = _dn(adj, 1)
        reasons.append(f"RSI={rsi:.0f} overbought >70: {adj} ↘ {new}")
        adj = new

    # 3. RSI oversold
    if rsi is not None and rsi < 30.0 and adj in ("↓↓ Calo forte", "↓ Calo lieve"):
        new = _up(adj, 1)
        reasons.append(f"RSI={rsi:.0f} oversold <30: {adj} ↗ {new}")
        adj = new

    return adj, reasons


def _predizione_label(slope_pct, beta: float | None = None) -> str:
    """
    Etichetta predittiva dalla pendenza %/giorno a T.
    Con beta > 1 la "zona stabile" si allarga proporzionalmente:
    un titolo volatile deve mostrare una tendenza più decisa per essere classificato.
    """
    if slope_pct is None:
        return "N/D"
    eff_stabile = min(_SLOPE_STABILE * max(1.0, float(beta or 1.0)), 2.5)
    if slope_pct >  3 * eff_stabile:
        return "↑↑ Forte crescita"
    if slope_pct >  eff_stabile:
        return "↑ Crescita lieve"
    if slope_pct >= -eff_stabile:
        return "→ Stabile"
    if slope_pct >= -3 * eff_stabile:
        return "↓ Calo lieve"
    return "↓↓ Calo forte"


def _motivazione_verifica(tipo: str, pred: str, slope_pct,
                          fit_r2=None, phase: str = "") -> str:
    """
    Spiega in linguaggio naturale perché la predizione è stata ✓ Corretta o ✗ Errata.
    """
    if tipo == "i) Controllo":
        return "Sponsor no match — trend non riconducibile al trial"
    if tipo == "⚠ Incerto (fase precoce)":
        return "Fase I/II con sponsor Partial — segnale statisticamente poco affidabile"
    if fit_r2 is not None and fit_r2 < R2_MIN:
        return f"Fitting insufficiente (R²={fit_r2:.2f} < {R2_MIN}) — pendenza non affidabile"
    if slope_pct is None or pred == "N/D":
        return "Dati di pendenza insufficienti"
    if tipo == "— (dati futuri)":
        return "Completion date futura — confronto non ancora disponibile"
    if pred == "→ Stabile":
        return "Pendenza in zona ambigua (±0.5 %/gg) — direzione non classificabile"
    if tipo == "ii) ~ Positivo parziale":
        return "Esito ambiguo (discesa 0÷15%) — troppo vicino al rumore di mercato per valutare"
    # direzione sintetica della pendenza
    _dir = pred.split(" ")[0] if pred and pred != "N/D" else "?"
    if tipo == "iii) ✓ Trial Success":
        if pred.startswith("↑"):
            return f"Pendenza pre-T {_dir} → coerente con esito positivo del trial"
        else:
            return f"Pendenza pre-T {_dir} suggeriva calo/stasi, ma il trial ha avuto esito positivo"
    if tipo == "— Calo forte":
        if pred.startswith("↑"):
            return f"Pendenza pre-T {_dir} suggeriva rialzo, ma il titolo ha ceduto oltre -15%"
        else:
            return f"Pendenza pre-T {_dir} → coerente con calo forte post-trial"
    return "Classificazione non determinabile"


def _verifica_predizione(tipo: str, pred: str, slope_pct,
                         fit_r2=None, phase: str = "") -> str:
    """
    Valuta se la predizione pre-T era coerente con l'esito reale.

    Filtri di qualità applicati prima della valutazione:
      - R² < R2_MIN              → N/D (fitting inaffidabile)
      - fase I/II + Partial      → ⚠ Incerto (fase precoce)
      - pendenza → Stabile       → N/D (zona ambigua, non classificabile)
      - "ii) ~ Positivo parziale"→ N/D (esito ambiguo: -15%÷0%, rumore di mercato)
        Solo "iii) ✓ Trial Success" (r20>0) e "— Calo forte" (r20<-15%)
        sono abbastanza netti da valutare la predizione.
    """
    if tipo == "i) Controllo":
        return "— Non correlato"
    if tipo == "⚠ Incerto (fase precoce)":
        return "⚠ Incerto (fase precoce)"
    if fit_r2 is not None and fit_r2 < R2_MIN:
        return "N/D"
    if slope_pct is None or pred == "N/D":
        return "N/D"
    if tipo == "— (dati futuri)":
        return "⏳ Non ancora verificabile"
    # Zona stabile = segnale troppo debole per giudicare
    if pred == "→ Stabile":
        return "N/D"
    # Positivo parziale (0% ÷ -15%): esito troppo ambiguo per valutare
    if tipo == "ii) ~ Positivo parziale":
        return "N/D"
    if tipo == "iii) ✓ Trial Success":
        return "✓ Corretta" if pred.startswith("↑") else "✗ Errata"
    if tipo == "— Calo forte":
        return "✗ Errata" if pred.startswith("↑") else "✓ Corretta"
    return "N/D"


def _price_at(close: pd.Series, target_date, tol: int = 10):
    if target_date is None:
        return None
    ts  = pd.Timestamp(target_date)
    idx = close.index
    window = close.loc[
        (idx >= ts - timedelta(days=tol)) &
        (idx <= ts + timedelta(days=tol))
    ]
    if window.empty:
        return None
    return float(window.iloc[(window.index - ts).map(abs).argmin()])


def _price_offset(close: pd.Series, target_date, offset_days: int):
    if target_date is None:
        return None
    ts2 = pd.Timestamp(target_date) + timedelta(days=offset_days)
    return _price_at(close, ts2.date(), tol=7)


def _fmt_pct(v):
    if v is None:
        return None
    return v / 100   # valore decimale per number_format "0.00%"


def _write_cell(ws, row, col, value, fill=None, font=None,
                align=ALIGN_L, fmt=None, border=None):
    c = ws.cell(row=row, column=col, value=value)
    if fill:   c.fill   = fill
    if font:   c.font   = font
    if align:  c.alignment = align
    if fmt:    c.number_format = fmt
    if border: c.border = border
    return c


def _pct_cell(ws, row, col, value, fill_base=True, fill_override=None):
    """
    Scrive una cella % con font verde/rosso automatico.
    - fill_override: se fornito, usa quel PatternFill come sfondo (ignora fill_base).
    - fill_base=True: sfondo POS/NEG_FILL; False: nessuno sfondo.
    """
    if value is None:
        _write_cell(ws, row, col, "N/D", font=NA_FONT, align=ALIGN_C,
                    fill=fill_override)
        return
    pct_val = value / 100
    font    = POS_FONT if value >= 0 else NEG_FONT
    if fill_override is not None:
        bg = fill_override
    elif fill_base:
        bg = POS_FILL if value >= 0 else NEG_FILL
    else:
        bg = None
    _write_cell(ws, row, col, pct_val,
                fill=bg, font=font, align=ALIGN_C, fmt="0.00%")


# ── Caricamento dati orchestrator ─────────────────────────────────────────────

def load_orchestrator():
    if not os.path.exists(INPUT_JSON):
        raise FileNotFoundError(
            f"File non trovato: {INPUT_JSON}\n"
            "Esegui prima 'python data_orchestrator.py'."
        )
    with open(INPUT_JSON, "r", encoding="utf-8") as f:
        payload = json.load(f)
    fin_records  = payload.get("financial", [])
    clin_records = payload.get("clinical_openfda", [])
    fin_df  = pd.DataFrame(fin_records)  if fin_records  else pd.DataFrame()
    clin_df = pd.DataFrame(clin_records) if clin_records else pd.DataFrame()
    return fin_df, clin_df


# ── Fetch storia yfinance ─────────────────────────────────────────────────────

def fetch_history(symbol: str) -> pd.DataFrame:
    """Download completo senza cache (usato internamente da fetch_history_cached)."""
    try:
        tk   = yf.Ticker(symbol)
        hist = tk.history(period="max", auto_adjust=True)
        hist.index = pd.to_datetime(hist.index).tz_localize(None)
        return hist
    except Exception as e:
        print(f"  [WARN] {symbol}: {e}")
        return pd.DataFrame()


def fetch_history_cached(symbol: str, force: bool = False) -> pd.DataFrame:
    """
    Scarica la storia prezzi con cache su disco (data/retro_cache/<SYM>.pkl).

    Logica:
    - Prima esecuzione (o force=True): scarica period=max e salva la cache.
    - Esecuzioni successive: legge la cache e aggiorna SOLO i giorni mancanti
      (dall'ultima data in cache ad oggi) con una chiamata incrementale.
    - I dati storici passati (completion dates chiuse) non cambiano mai,
      quindi il cache hit è quasi totale dopo la prima volta.
    - Usa --force per forzare un refresh completo (es. dopo uno stock split).
    """
    import pickle as _pickle

    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_file = os.path.join(CACHE_DIR, f"{symbol}.pkl")
    today      = date.today()

    # ── Carica cache esistente ────────────────────────────────────────────────
    cached: pd.DataFrame | None = None
    if not force and os.path.exists(cache_file):
        try:
            with open(cache_file, "rb") as _f:
                cached = _pickle.load(_f)
        except Exception:
            cached = None  # cache corrotta → riscarica

    if cached is not None and not cached.empty:
        last_cached = cached.index[-1].date()
        days_old    = (today - last_cached).days

        # Cache ancora fresca (oggi o ieri per mercati chiusi il weekend)
        if days_old <= 1:
            print("·cache·", end=" ", flush=True)
            return cached

        # Aggiornamento incrementale: solo i giorni mancanti
        start_str = (last_cached + timedelta(days=1)).strftime("%Y-%m-%d")
        try:
            new_hist = yf.Ticker(symbol).history(start=start_str, auto_adjust=True)
            if not new_hist.empty:
                new_hist.index = pd.to_datetime(new_hist.index).tz_localize(None)
                # Rimuovi eventuali duplicati (date già presenti in cache)
                new_hist = new_hist[~new_hist.index.isin(cached.index)]
                combined = pd.concat([cached, new_hist]).sort_index()
            else:
                combined = cached  # nessun dato nuovo (es. ticker sospeso)

            with open(cache_file, "wb") as _f:
                _pickle.dump(combined, _f)
            print(f"·+{len(new_hist)}gg·", end=" ", flush=True)
            return combined
        except Exception as e:
            print(f"  [WARN cache-update] {symbol}: {e} — uso cache esistente")
            return cached

    # ── Nessuna cache (o force): download completo ────────────────────────────
    hist = fetch_history(symbol)
    if not hist.empty:
        try:
            with open(cache_file, "wb") as _f:
                _pickle.dump(hist, _f)
        except Exception:
            pass  # errore scrittura cache non bloccante
    return hist


def fetch_info_cached(symbol: str, fallback: dict | None = None,
                      force: bool = False) -> dict:
    """
    Scarica yf.Ticker(sym).info con cache JSON su disco.
    TTL = 7 giorni (i metadati — settore, paese, valuta — cambiano raramente).
    """
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_file = os.path.join(CACHE_DIR, f"{symbol}_info.json")
    INFO_TTL   = 7  # giorni

    if not force and os.path.exists(cache_file):
        try:
            mtime_date = date.fromtimestamp(os.path.getmtime(cache_file))
            if (date.today() - mtime_date).days < INFO_TTL:
                with open(cache_file, "r", encoding="utf-8") as _f:
                    return json.load(_f)
        except Exception:
            pass

    try:
        info = yf.Ticker(symbol).info or {}
    except Exception:
        info = {}

    if not info:
        return fallback or {}

    try:
        with open(cache_file, "w", encoding="utf-8") as _f:
            json.dump(info, _f, ensure_ascii=False, default=str)
    except Exception:
        pass
    return info


# ── Calcolo metriche finanziarie ──────────────────────────────────────────────

def compute_metrics(symbol: str, hist: pd.DataFrame, info: dict) -> dict:
    if hist.empty:
        return {"symbol": symbol, "error": "no data"}

    close  = hist["Close"]
    volume = hist["Volume"].copy() if "Volume" in hist.columns else pd.Series(dtype=float)
    today = date.today()

    first_dt    = hist.index[0].date()
    last_dt     = hist.index[-1].date()
    first_price = float(close.iloc[0])
    last_price  = float(close.iloc[-1])
    ath_val     = float(close.max())
    ath_dt      = close.idxmax().date()
    atl_val     = float(close.min())
    atl_dt      = close.idxmin().date()
    total_ret   = _pct(last_price, first_price)
    dist_ath    = _pct(last_price, ath_val)

    # Volatilità annualizzata
    daily_ret = close.pct_change().dropna()
    vol_ann   = float(daily_ret.std() * math.sqrt(252) * 100) if not daily_ret.empty else None

    # Rendimenti per periodo
    def _ret_n(days):
        cutoff = hist.index[-1] - timedelta(days=days)
        sub    = hist.loc[hist.index >= cutoff]
        if sub.empty:
            return None
        return _pct(last_price, float(sub["Close"].iloc[0]))

    # Rendimento giornaliero (ultimo giorno di trading)
    ret_1d = None
    if len(close) >= 2:
        ret_1d = _pct(float(close.iloc[-1]), float(close.iloc[-2]))

    return {
        "symbol":       symbol,
        "name":         info.get("longName") or info.get("shortName", symbol),
        "sector":       info.get("sector", ""),
        "country":      info.get("country", ""),
        "currency":     info.get("currency", ""),
        "exchange":     info.get("exchange", ""),
        "market_cap":   info.get("marketCap"),
        "first_date":   first_dt,
        "last_date":    last_dt,
        "first_price":  first_price,
        "last_price":   last_price,
        "total_ret":    total_ret,
        "ath_val":      ath_val,
        "ath_date":     ath_dt,
        "dist_ath":     dist_ath,
        "atl_val":      atl_val,
        "atl_date":     atl_dt,
        "vol_ann":      vol_ann,
        "ret_1d":       ret_1d,
        "ret_1m":       _ret_n(30),
        "ret_3m":       _ret_n(90),
        "ret_6m":       _ret_n(180),
        "ret_1y":       _ret_n(365),
        "ret_3y":       _ret_n(365 * 3),
        "ret_5y":       _ret_n(365 * 5),
        "beta":         info.get("beta"),     # beta di mercato (da yfinance info)
        "volume":       volume,               # serie volumi giornalieri
        "close":        close,                # serie prezzi per calcolo impatto
    }


# ── Calcolo impatto clinico ───────────────────────────────────────────────────

def compute_clinical_impact(clin_df: pd.DataFrame, metrics_map: dict,
                            window: int) -> list[dict]:
    if clin_df.empty:
        return []

    ticker_col = _pick(["ticker", "symbol", "Ticker"], clin_df)
    date_col   = _pick(_DATE_CANDIDATES,   clin_df)
    title_col  = _pick(_TITLE_CANDIDATES,  clin_df)
    phase_col  = _pick(_PHASE_CANDIDATES,  clin_df)
    status_col = _pick(_STATUS_CANDIDATES, clin_df)
    spon_col   = _pick(["sponsor_match"],  clin_df)

    if not ticker_col or not date_col:
        return []

    # Carica XBI una volta sola come proxy di mercato biotech
    _xbi_close = _fetch_xbi_close(force=FORCE_CACHE)
    if _xbi_close.empty:
        print("  [retro] XBI non disponibile — colonna 'Pendenza Adj. XBI' sarà N/D")

    df = clin_df.copy()
    df["_sym"]  = df[ticker_col].astype(str).str.strip().str.upper()
    df["_date"] = pd.to_datetime(df[date_col], errors="coerce").dt.date
    df = df[df["_date"].notna()].sort_values("_date")

    rows = []
    for _, row in df.iterrows():
        sym = row["_sym"]
        m   = metrics_map.get(sym)
        if m is None or "close" not in m:
            continue
        close  = m["close"]
        volume = m.get("volume", pd.Series(dtype=float))
        cd     = row["_date"]

        p_before = _price_offset(close, cd, -window)
        p_at     = _price_at(close, cd)
        p_after  = _price_offset(close, cd, +window)

        # Variazioni granulari pre-evento (T-N → T)
        PRE_DAYS  = [20, 10, 7, 5, 1]
        POST_DAYS = [1,  5,  7, 10, 20]
        pre_rets  = {n: _pct(p_at, _price_offset(close, cd, -n)) for n in PRE_DAYS}
        post_rets = {n: _pct(_price_offset(close, cd, +n), p_at) for n in POST_DAYS}

        spon_raw = str(row[spon_col]).strip() if spon_col else "N/D"
        if spon_raw in ("", "nan", "None"):
            spon_raw = "N/D"

        # ── Success indicator ─────────────────────────────────────────────────
        # Conta quante finestre post sono ≥ 0 (prezzo stabile o in aumento)
        _post_vals = [post_rets[n] for n in POST_DAYS]
        _valid     = [v for v in _post_vals if v is not None]
        _pos_count = sum(1 for v in _valid if v >= 0)
        _tot       = len(_valid)
        if _tot == 0:
            _success = "N/D"
        elif _pos_count >= 4:
            _success = f"✓ Success ({_pos_count}/{_tot})"
        elif _pos_count == 3:
            _success = f"~ Stabile ({_pos_count}/{_tot})"
        elif _pos_count >= 1:
            _success = f"⚠ Debole ({_pos_count}/{_tot})"
        else:
            _success = f"✗ Fail (0/{_tot})"

        # ── Tipo evento (3 categorie) ──────────────────────────────────────────
        _r20 = post_rets.get(20)
        if spon_raw in ("No match", "N/D"):
            _tipo = "i) Controllo"
        elif _r20 is None:
            _tipo = "— (dati futuri)"
        elif _r20 > 0:
            _tipo = "iii) ✓ Trial Success"
        elif _r20 > -15:
            _tipo = "ii) ~ Positivo parziale"
        else:
            _tipo = "— Calo forte"

        # ── Curve fitting pre-T → pendenza e predizione ───────────────────────
        # Ricostruzione prezzi pre-T dai ret_pre (% da T-N a T)
        _xp = [-20, -10, -7, -5, -1, 0]
        _yp = []
        for _d in [20, 10, 7, 5, 1]:
            _ret = pre_rets.get(_d)
            if _ret is not None and p_at and p_at > 0:
                _yp.append(p_at / (1.0 + _ret / 100.0))
            else:
                _yp.append(None)
        _yp.append(p_at)   # x=0: prezzo a T

        _slope_pct, _fit_model, _fit_r2 = _fit_pre_curve(_xp, _yp, p_at)

        # Segnali extra
        _beta      = m.get("beta")                                    # beta di mercato
        _vol_ratio = _volume_ratio_pre(volume, cd)                    # build-up volume pre-T
        _exc_slope = _market_excess_slope(close, cd, _xbi_close)      # slope al netto di XBI

        # Usa excess slope se disponibile, altrimenti raw slope
        _slope_for_pred = _exc_slope if _exc_slope is not None else _slope_pct

        _pred_raw  = _predizione_label(_slope_for_pred, beta=_beta)
        _rsi_val   = _rsi_at_t(close, cd) if (close is not None and not close.empty) else None
        _ret_pre_v = _pct(p_at, p_before)
        _pred_adj, _adj_notes = _apply_pred_adj(_pred_raw, _rsi_val, _ret_pre_v,
                                                  vol_ratio=_vol_ratio)
        _pred  = _pred_adj      # la predizione usata ovunque include già le correzioni
        _phase = str(row[phase_col]).strip() if phase_col else ""

        # ── Filtro fase precoce: fase I/II + sponsor Partial → incerto ──────
        _phase_low = any(
            tok in _phase.upper()
            for tok in ("PHASE 1", "PHASE1", "PHASE I", "PHASE_1",
                        "PHASE 2", "PHASE2", "PHASE II", "PHASE_2",
                        " 1 ", " 2 ", "/1", "/2", "1/2", "2/3")
        ) if _phase else False
        if _phase_low and spon_raw == "Partial" and _tipo != "i) Controllo":
            _tipo = "⚠ Incerto (fase precoce)"

        rows.append({
            "ticker":        sym,
            "name":          m.get("name", ""),
            "phase":         _phase,
            "comp_date":     cd,
            "title":         str(row[title_col]).strip()  if title_col  else "",
            "status":        str(row[status_col]).strip() if status_col else "",
            "sponsor_match": spon_raw,
            "currency":      m.get("currency", ""),
            "p_before":      p_before,
            "p_at":          p_at,
            "p_after":       p_after,
            "ret_pre":       _pct(p_at, p_before),
            "ret_post":      _pct(p_after, p_at),
            # granulari pre
            "ret_pre_20":    pre_rets[20],
            "ret_pre_10":    pre_rets[10],
            "ret_pre_7":     pre_rets[7],
            "ret_pre_5":     pre_rets[5],
            "ret_pre_1":     pre_rets[1],
            # granulari post
            "ret_post_1":    post_rets[1],
            "ret_post_5":    post_rets[5],
            "ret_post_7":    post_rets[7],
            "ret_post_10":   post_rets[10],
            "ret_post_20":   post_rets[20],
            # successo post-evento
            "success":       _success,
            # classificazione e fitting
            "tipo_evento":   _tipo,
            "slope_pct":     round(_slope_pct, 3) if _slope_pct is not None else None,
            "fit_r2":        _fit_r2,
            "fit_model":     f"{_fit_model} (R²={_fit_r2})" if _fit_r2 is not None else "N/D",
            "predizione":    _pred,         # già corretta da RSI/buy-the-rumor
            "pred_raw":      _pred_raw,     # predizione raw (solo pendenza)
            "rsi_pre":       _rsi_val,      # RSI-14 a T
            # verifica con filtri qualità (R², zona stabile, fase precoce)
            "verifica":    _verifica_predizione(_tipo, _pred, _slope_for_pred,
                                                fit_r2=_fit_r2, phase=_phase),
            "motivazione": (_motivazione_verifica(_tipo, _pred, _slope_for_pred,
                                                   fit_r2=_fit_r2, phase=_phase)
                            + (" | " + "; ".join(_adj_notes) if _adj_notes else "")),
            # giorno di dissociazione dalla curva pre-T
            "dissociation":  _dissociation_day(close, cd, p_at),
            # segnali aggiuntivi
            "beta":          _beta,
            "vol_ratio_pre": _vol_ratio,       # build-up volume pre-T
            "exc_slope":     _exc_slope,       # pendenza al netto XBI (%/gg)
            "slope_used":    _slope_for_pred,  # slope effettivamente usata per pred
        })
    return rows


# ── Scrittura Sheet 1: Riepilogo IPO ─────────────────────────────────────────

def write_riepilogo_sheet(wb: Workbook, metrics_list: list[dict]) -> None:
    ws = wb.create_sheet("Riepilogo IPO")
    ws.sheet_properties.tabColor = "1F3864"

    COLS = [
        ("Ticker",         10, ALIGN_C),
        ("Società",        32, ALIGN_L),
        ("Settore",        18, ALIGN_L),
        ("Paese",           9, ALIGN_C),
        ("Valuta",          7, ALIGN_C),
        ("Prima Data",     12, ALIGN_C),
        ("Prezzo IPO",     12, ALIGN_R),
        ("Prezzo Attuale", 13, ALIGN_R),
        ("Δ Totale %",     11, ALIGN_C),
        ("ATH",            11, ALIGN_R),
        ("Data ATH",       12, ALIGN_C),
        ("Δ dall'ATH %",   12, ALIGN_C),
        ("Vol. Ann. %",    11, ALIGN_C),
        ("Rend. 1Y %",     11, ALIGN_C),
        ("Rend. 3Y %",     11, ALIGN_C),
        ("Rend. 5Y %",     11, ALIGN_C),
        ("N° Studi",        9, ALIGN_C),
    ]
    ncols = len(COLS)

    # ── Titolo ────────────────────────────────────────────────────────────────
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    _write_cell(ws, 1, 1,
                f"Riepilogo Storico dall'IPO — generato il {date.today().strftime('%d/%m/%Y')}",
                fill=TITLE_FILL, font=TITLE_FONT, align=ALIGN_C)
    ws.row_dimensions[1].height = 28

    # ── Descrizioni ───────────────────────────────────────────────────────────
    descriptions = [
        "Simbolo", "Nome completo società", "Settore di appartenenza",
        "Paese sede", "Valuta", "Primo giorno di trading (proxy IPO)",
        "Prezzo chiusura primo giorno", "Prezzo chiusura più recente",
        "Rendimento totale dal primo giorno", "All-Time High (massimo storico)",
        "Data ATH", "Distanza % dall'ATH attuale",
        "Volatilità annualizzata (deviazione std rendimenti × √252)",
        "Rendimento a 1 anno", "Rendimento a 3 anni", "Rendimento a 5 anni",
        "Numero studi clinici nel dataset",
    ]
    for ci, ((hdr, w, al), desc) in enumerate(zip(COLS, descriptions), start=1):
        _write_cell(ws, 2, ci, hdr,  fill=HEADER_FILL, font=HEADER_FONT, align=ALIGN_C)
        _write_cell(ws, 3, ci, desc, fill=DESC_FILL,   font=DESC_FONT,   align=ALIGN_C)
        ws.column_dimensions[get_column_letter(ci)].width = w

    ws.row_dimensions[2].height = 22
    ws.row_dimensions[3].height = 38

    ws.freeze_panes = "A4"
    ws.print_title_rows = "1:3"

    # ── Dati ──────────────────────────────────────────────────────────────────
    for ri, m in enumerate(metrics_list, start=4):
        bg = ODD_FILL if ri % 2 == 0 else EVEN_FILL

        def _c(col, val, fmt=None, fill=None, font=None, align=None):
            al = align or COLS[col - 1][2]
            _write_cell(ws, ri, col, val,
                        fill=fill or bg, font=font or DATA_FONT,
                        align=al, fmt=fmt, border=BORDER_THIN)

        cur = m.get("currency", "")
        num_fmt = f'#,##0.00 "{cur}"' if cur else "#,##0.00"

        _c(1,  m["symbol"],
           fill=PatternFill("solid", fgColor="D6E4F7"),
           font=Font(bold=True, size=10, color="1F3864"), align=ALIGN_C)
        _c(2,  m.get("name", ""))
        _c(3,  m.get("sector", ""))
        _c(4,  m.get("country", ""),   align=ALIGN_C)
        _c(5,  cur,                    align=ALIGN_C)
        _c(6,  m.get("first_date"),    fmt="DD/MM/YYYY", align=ALIGN_C)
        _c(7,  m.get("first_price"),   fmt=num_fmt,      align=ALIGN_R)
        _c(8,  m.get("last_price"),    fmt=num_fmt,      align=ALIGN_R)

        _pct_cell(ws, ri, 9,  m.get("total_ret"))

        _c(10, m.get("ath_val"),  fmt=num_fmt, align=ALIGN_R)
        _c(11, m.get("ath_date"), fmt="DD/MM/YYYY", align=ALIGN_C)

        _pct_cell(ws, ri, 12, m.get("dist_ath"))
        _pct_cell(ws, ri, 13, m.get("vol_ann"),  fill_base=False)
        _pct_cell(ws, ri, 14, m.get("ret_1y"))
        _pct_cell(ws, ri, 15, m.get("ret_3y"))
        _pct_cell(ws, ri, 16, m.get("ret_5y"))

        _c(17, m.get("n_studies", 0), align=ALIGN_C,
           font=Font(bold=True, size=10,
                     color="1F3864" if (m.get("n_studies") or 0) > 0 else "888888"))

        ws.row_dimensions[ri].height = 18

    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToPage  = True
    ws.page_setup.fitToWidth = 1


# ── Scrittura Sheet 2: Impatto Clinici ────────────────────────────────────────

def write_impact_sheet(wb: Workbook, impact_rows: list[dict], window: int) -> None:
    ws = wb.create_sheet("Impatto Clinici")
    ws.sheet_properties.tabColor = "70AD47"

    # ── Calcolo accuratezza reale sulle righe passate valutabili ─────────────
    def _is_pret_strong(r: dict) -> bool:
        """Segnali pre-T forti: vol build-up ≥1.5× E slope aggiustata positiva."""
        vr  = r.get("vol_ratio_pre")
        exc = r.get("exc_slope")
        sp  = r.get("slope_pct") or 0.0
        vol_ok   = (vr is not None and vr >= 1.5)
        slope_ok = (exc > 0 if exc is not None else sp > 0)
        return vol_ok and slope_ok

    def _is_exact(r: dict) -> bool:
        """Solo righe con sponsor confirmato (Exact match)."""
        return str(r.get("sponsor_match", "")).strip() == "Exact"

    # Accuratezza su righe con sponsor Exact (le uniche affidabili)
    _ex_rows = [r for r in impact_rows if _is_exact(r)]
    _n_ok    = sum(1 for r in _ex_rows if "✓" in str(r.get("verifica", "")))
    _n_err   = sum(1 for r in _ex_rows if "✗" in str(r.get("verifica", "")))
    _n_tot   = _n_ok + _n_err
    _acc_pct = (_n_ok / _n_tot * 100) if _n_tot > 0 else 0.0

    # Stessa cosa ma solo dove anche i segnali pre-T sono forti
    _pm_rows = [r for r in _ex_rows if _is_pret_strong(r)]
    _pm_ok   = sum(1 for r in _pm_rows if "✓" in str(r.get("verifica", "")))
    _pm_err  = sum(1 for r in _pm_rows if "✗" in str(r.get("verifica", "")))
    _pm_tot  = _pm_ok + _pm_err
    _pm_pct  = (_pm_ok / _pm_tot * 100) if _pm_tot > 0 else 0.0

    _acc_str = (
        f"Sponsor Exact — ✓ {_n_ok}  ✗ {_n_err}  Tot. {_n_tot}  →  {_acc_pct:.1f}%\n"
        f"★★ Exact + pre-T (vol≥1.5×+slope+) — ✓ {_pm_ok}  ✗ {_pm_err}  Tot. {_pm_tot}  →  {_pm_pct:.1f}%\n"
        f"(escl. Partial · No match · N/D · Futuri)"
    )

    # Colonne fisse pre/post granulari (giorni)
    _PRE_DAYS  = [20, 10, 7, 5, 1]
    _POST_DAYS = [1,  5,  7, 10, 20]

    COLS = [
        ("Ticker",                     10, ALIGN_C),
        ("Società",                    28, ALIGN_L),
        ("Fase Clinica",               14, ALIGN_C),
        ("Completion Date",            14, ALIGN_C),
        ("Titolo Studio",              52, WRAP_L),
        ("Status",                     16, ALIGN_C),
        ("Sponsor\nMatch",             13, ALIGN_C),   # col 7
        (f"Prezzo T-{window}gg",       13, ALIGN_R),
        ("Prezzo T\n(completion)",     14, ALIGN_R),
        (f"Prezzo T+{window}gg",       13, ALIGN_R),
        (f"Δ ±{window}gg\npre %",     11, ALIGN_C),
        (f"Δ ±{window}gg\npost %",    11, ALIGN_C),
        # ── granulari pre ──
        ("Δ T-20→T %",                11, ALIGN_C),
        ("Δ T-10→T %",                11, ALIGN_C),
        ("Δ T-7→T %",                 11, ALIGN_C),
        ("Δ T-5→T %",                 11, ALIGN_C),
        ("Δ T-1→T %",                 11, ALIGN_C),
        # ── granulari post ──
        ("Δ T→T+1 %",                 11, ALIGN_C),
        ("Δ T→T+5 %",                 11, ALIGN_C),
        ("Δ T→T+7 %",                 11, ALIGN_C),
        ("Δ T→T+10 %",                11, ALIGN_C),
        ("Δ T→T+20 %",                11, ALIGN_C),
        # ── esito ──
        ("Success",                   15, ALIGN_C),   # col 23
        # ── fitting e predizione ──
        ("Tipo\nEvento",              16, ALIGN_C),   # col 24
        ("Pendenza\npre-T (%/gg)",    14, ALIGN_C),   # col 25
        ("Predizione\npost-T",        16, ALIGN_C),   # col 26
        ("Verifica\nPredizione",      18, ALIGN_C),   # col 27
        ("Motivazione\nVerifica",    38, ALIGN_L),   # col 28
        ("Giorno\nDissociazione",    14, ALIGN_C),   # col 29
        ("Pendenza\nAdj. XBI",      13, ALIGN_C),   # col 30  excess slope vs mercato
        ("Vol.\nBuild-up pre-T",    12, ALIGN_C),   # col 31  rapporto volume
        ("Segnale\nComposito",      10, ALIGN_C),   # col 32  qualità complessiva ★★★
        ("RSI\npre-T",              9,  ALIGN_C),   # col 33  RSI-14 all'ultimo gg pre-T
    ]
    ncols = len(COLS)

    # Indici colonne (1-based)
    _SPON_COL       = 7
    _GRAN_PRE_COLS  = list(range(13, 18))   # 13..17
    _GRAN_POST_COLS = list(range(18, 23))   # 18..22
    _SUCCESS_COL    = 23
    _TIPO_COL       = 24
    _SLOPE_COL      = 25
    _PRED_COL       = 26
    _VERIFICA_COL   = 27
    _MOTIV_COL      = 28
    _DISS_COL       = 29
    _EXC_SLOPE_COL  = 30
    _VOL_COL        = 31
    _SEGNALE_COL    = 32
    _RSI_COL        = 33

    # ── Titolo ────────────────────────────────────────────────────────────────
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    _write_cell(ws, 1, 1,
                f"Impatto Completion Date Studi Clinici  ·  Finestra ±{window} giorni  ·  {date.today().strftime('%d/%m/%Y')}",
                fill=PatternFill("solid", fgColor="375623"),
                font=TITLE_FONT, align=ALIGN_C)
    ws.row_dimensions[1].height = 28

    # Intestazione di gruppo per le sezioni granulari (riga 2b = riga 3 attuale)
    # Scriviamo prima le intestazioni colonna, poi sovrascriviamo il gruppo header
    descriptions = [
        "Simbolo ticker", "Nome completo società", "Fase dello studio clinico",
        "Data completion primaria", "Titolo breve dello studio", "Status globale",
        "Exact / Partial / No match — confronto sponsor con società",
        f"Prezzo {window}gg prima",
        "Prezzo al giorno T (o più vicino)",
        f"Prezzo {window}gg dopo",
        f"Var. % da T-{window} a T",
        f"Var. % da T a T+{window}",
        "Var. % da T-20 a T", "Var. % da T-10 a T",
        "Var. % da T-7 a T",  "Var. % da T-5 a T", "Var. % da T-1 a T",
        "Var. % da T a T+1",  "Var. % da T a T+5",
        "Var. % da T a T+7",  "Var. % da T a T+10", "Var. % da T a T+20",
        "Esito post-evento: quante finestre T+N mostrano prezzo ≥ T (✓ 4-5/5  ~ 3/5  ⚠ 1-2/5  ✗ 0/5)",
        "i) Controllo (No match)  ii) Positivo parziale  iii) Trial Success — basato su sponsor e ret_post_20",
        "Pendenza della curva di fitting al giorno T (%/gg rispetto al prezzo T) — modello migliore per R²",
        "Predizione andamento post-T dalla pendenza: ↑↑ Forte / ↑ Lieve / → Stabile / ↓ Lieve / ↓↓ Forte",
        _acc_str,   # col 27 — accuratezza live calcolata all'apertura
        "Spiegazione dettagliata del motivo per cui la predizione è corretta o errata — basata su direzione pendenza pre-T vs esito del trial",
        f"Primo giorno post-T in cui il prezzo reale si discosta dalla curva pre-T di oltre max(3%, 1.5×σ residui) — D+N, >{_DISS_MAX_DAYS}gg, — (futuro), N/D",
        "Pendenza pre-T al netto dell'ETF biotech XBI — isola l'alpha specifico del trial dal moto di mercato (%/gg excess return / n_sessioni). Usata come base della Predizione.",
        "Volume medio 5gg pre-T ÷ media 15gg precedenti. ≥1.5× ▲ = accumulo (trader si posizionano prima dell'annuncio — segnale forte). 0.7–1.5× = volume nella norma. ≤0.7× ▼ = volume in calo (segnale debole). Un segnale ↑ con volume in calo è meno affidabile.",
        "Qualità complessiva: ★★★ = Vol build-up + Slope XBI positiva + Predizione verificata ✓ | ★★ = 2 segnali su 3 | ★ = 1 segnale | – = nessun segnale. Le righe sono ordinate per questa colonna (decrescente) all'interno di ogni ticker.",
        "RSI-14 (Wilder EWM) calcolato all'ultimo giorno di borsa prima di T. >70 = overbought (rosso) → predizione rialzista abbassata di un livello. <30 = oversold (verde) → predizione ribassista alzata. 30–70 = zona neutrale. La correzione è già applicata alla colonna 'Predizione post-T'.",
    ]

    HDR_FILL_DARK    = PatternFill("solid", fgColor="375623")
    HDR_FILL_SPON    = PatternFill("solid", fgColor="4A4A4A")   # grigio scuro = sponsor
    HDR_FILL_PRE     = PatternFill("solid", fgColor="1F3864")   # blu scuro = pre
    HDR_FILL_POST    = PatternFill("solid", fgColor="7B2C2C")   # rosso scuro = post
    HDR_FILL_SUCCESS = PatternFill("solid", fgColor="203A1F")   # verde molto scuro
    HDR_FILL_PRED    = PatternFill("solid", fgColor="4B1C82")   # viola scuro = predizione

    # Colori semantici sponsor match (sfondo cella)
    _SPON_FILLS = {
        "Exact":    PatternFill("solid", fgColor="C6EFCE"),   # verde chiaro
        "Partial":  PatternFill("solid", fgColor="FFEB9C"),   # giallo chiaro
        "No match": PatternFill("solid", fgColor="FFC7CE"),   # rosso chiaro
    }
    _SPON_FONTS = {
        "Exact":    Font(bold=True, color="375623", size=9),
        "Partial":  Font(bold=True, color="7D5A00", size=9),
        "No match": Font(bold=True, color="9C0006", size=9),
    }

    for ci, ((hdr, w, al), desc) in enumerate(zip(COLS, descriptions), start=1):
        if ci == _SPON_COL:
            hfill = HDR_FILL_SPON
        elif ci in _GRAN_PRE_COLS:
            hfill = HDR_FILL_PRE
        elif ci in _GRAN_POST_COLS:
            hfill = HDR_FILL_POST
        elif ci == _SUCCESS_COL:
            hfill = HDR_FILL_SUCCESS
        elif ci in (_TIPO_COL, _SLOPE_COL, _PRED_COL, _VERIFICA_COL,
                    _MOTIV_COL, _DISS_COL, _EXC_SLOPE_COL, _VOL_COL,
                    _SEGNALE_COL, _RSI_COL):
            hfill = HDR_FILL_PRED
        else:
            hfill = HDR_FILL_DARK
        _write_cell(ws, 2, ci, hdr,  fill=hfill,    font=HEADER_FONT, align=ALIGN_C)
        _write_cell(ws, 3, ci, desc, fill=DESC_FILL, font=DESC_FONT,   align=ALIGN_C)
        ws.column_dimensions[get_column_letter(ci)].width = w

    ws.row_dimensions[2].height = 28
    ws.row_dimensions[3].height = 58
    ws.freeze_panes = "A4"
    ws.print_title_rows = "1:3"
    ws.auto_filter.ref = f"A2:{get_column_letter(ncols)}2"   # SORT in Excel

    # ── Stile speciale cella accuratezza (riga 3, col 27) ────────────────────
    _acc_fill  = PatternFill("solid", fgColor="4B1C82")        # viola pieno
    _acc_font  = Font(bold=True, color="FFFFFF", size=9)
    _acc_align = Alignment(horizontal="center", vertical="center",
                           wrap_text=True)
    _acc_cell  = ws.cell(row=3, column=_VERIFICA_COL)
    _acc_cell.fill      = _acc_fill
    _acc_cell.font      = _acc_font
    _acc_cell.alignment = _acc_align

    # ── Helper: punteggio segnale composito ───────────────────────────────────
    def _signal_score(r: dict) -> int:
        """0-3: un punto per vol build-up ≥1.5, XBI slope >0, verifica ✓."""
        s = 0
        vr  = r.get("vol_ratio_pre")
        if vr is not None and vr >= 1.5:
            s += 1
        exc = r.get("exc_slope")
        sp  = r.get("slope_pct") or 0.0
        if exc is not None:
            if exc > 0:
                s += 1
        elif sp > 0:
            s += 1
        if "✓" in str(r.get("verifica", "")):
            s += 1
        return s

    # Ordina per ticker, poi: passati (★★★→–), poi futuri per data crescente
    from datetime import date as _today_cls
    _today = _today_cls.today()

    def _is_future(r: dict) -> bool:
        cd = r.get("comp_date")
        try:
            return (cd is not None) and (cd > _today)
        except Exception:
            return False

    # ── Sort cronologico: passati (dal più vecchio), poi futuri (prossimi prima) ─
    _past_rows   = sorted(
        [r for r in impact_rows if not _is_future(r)],
        key=lambda r: r.get("comp_date") or _today_cls.min
    )
    _future_rows = sorted(
        [r for r in impact_rows if _is_future(r)],
        key=lambda r: r.get("comp_date") or _today_cls.min
    )
    # None = sentinella per riga separatrice tra passati e futuri
    _all_rows: list = _past_rows + ([None] + _future_rows if _future_rows else [])

    _STAR_FILLS = {
        3: PatternFill("solid", fgColor="FFF2CC"),   # oro chiaro  ★★★
        2: PatternFill("solid", fgColor="E2EFDA"),   # verde chiaro ★★
        1: PatternFill("solid", fgColor="EEF2FA"),   # blu molto chiaro ★
        0: None,
    }
    _STAR_FONTS = {
        3: Font(bold=True, color="7D5A00", size=11),
        2: Font(bold=True, color="375623", size=10),
        1: Font(color="404080",            size=10),
        0: Font(color="AAAAAA",            size=9),
    }

    # ── Loop dati: cronologico, con separatore prima dei futuri ──────────────
    prev_sym   = None
    sect_start = 4

    _SEP_FILL  = PatternFill("solid", fgColor="1F3864")
    _SEP_FONT  = Font(bold=True, color="FFFFFF", size=10)

    _last_data_row = 3  # aggiornato nel loop; usato dal riepilogo in fondo
    _ri = 4
    for _row_item in _all_rows:
        ri = _ri

        # ── Riga separatrice tra storici e futuri ────────────────────────
        if _row_item is None:
            ws.merge_cells(start_row=ri, start_column=1,
                           end_row=ri,   end_column=ncols)
            _write_cell(ws, ri, 1,
                        "━━━━━━━━━━━━━━━━━━━━  Studi con Completion Date Futura  ━━━━━━━━━━━━━━━━━━━━",
                        fill=_SEP_FILL, font=_SEP_FONT, align=ALIGN_C)
            ws.row_dimensions[ri].height = 20
            _ri += 1
            continue

        row = _row_item
        _last_data_row = ri
        bg  = ODD_FILL if ri % 2 == 0 else EVEN_FILL
        sym = row["ticker"]
        cur = row.get("currency", "")
        num_fmt = f'#,##0.00 "{cur}"' if cur else "#,##0.00"

        # Bordo separatore cambio società
        if sym != prev_sym:
            if prev_sym is not None:
                for ci in range(1, ncols + 1):
                    ws.cell(row=ri - 1, column=ci).border = Border(
                        bottom=Side(style="medium", color="375623")
                    )
            prev_sym   = sym
            sect_start = ri

        def _c(col, val, fmt=None, fill=None, font=None, align=None):
            al = align or COLS[col - 1][2]
            _write_cell(ws, ri, col, val,
                        fill=fill or bg, font=font or DATA_FONT,
                        align=al, fmt=fmt)

        _c(1, sym,
           fill=PatternFill("solid", fgColor="D6EAD6"),
           font=Font(bold=True, size=10, color="375623"), align=ALIGN_C)
        _c(2,  row.get("name", ""))
        _c(3,  row.get("phase", "—"),  align=ALIGN_C, font=Font(bold=True, size=10))
        _c(4,  row.get("comp_date"),   fmt="DD/MM/YYYY", align=ALIGN_C)
        _c(5,  row.get("title", "—"),  align=WRAP_L)
        _c(6,  row.get("status", "—"), align=ALIGN_C)

        # Col 7: Sponsor Match — colore semantico Exact/Partial/No match
        spon_val = row.get("sponsor_match", "N/D") or "N/D"
        _write_cell(ws, ri, _SPON_COL, spon_val,
                    fill=_SPON_FILLS.get(spon_val, bg),
                    font=_SPON_FONTS.get(spon_val, Font(color="888888", size=9, italic=True)),
                    align=ALIGN_C)

        _c(8,  row.get("p_before"),    fmt=num_fmt, align=ALIGN_R)
        _c(9,  row.get("p_at"),        fmt=num_fmt, align=ALIGN_R)
        _c(10, row.get("p_after"),     fmt=num_fmt, align=ALIGN_R)

        # Δ window pre/post
        _pct_cell(ws, ri, 11, row.get("ret_pre"))
        _pct_cell(ws, ri, 12, row.get("ret_post"))

        # Δ granulari pre (T-20→T … T-1→T) — sfondo blu molto chiaro
        PRE_BG  = PatternFill("solid", fgColor="DCE6F1")
        POST_BG = PatternFill("solid", fgColor="F2DCDB")
        for ci, n in zip(_GRAN_PRE_COLS, _PRE_DAYS):
            _pct_cell(ws, ri, ci, row.get(f"ret_pre_{n}"),
                      fill_override=PRE_BG if bg == ODD_FILL
                                    else PatternFill("solid", fgColor="EEF4FA"))

        # Δ granulari post (T→T+1 … T→T+20) — sfondo rosso molto chiaro
        for ci, n in zip(_GRAN_POST_COLS, _POST_DAYS):
            _pct_cell(ws, ri, ci, row.get(f"ret_post_{n}"),
                      fill_override=POST_BG if bg == ODD_FILL
                                    else PatternFill("solid", fgColor="F9ECEB"))

        # Col 23: Success indicator
        _succ_val = row.get("success", "N/D")
        _SUCCESS_STYLE = {
            "✓": (PatternFill("solid", fgColor="C6EFCE"), Font(bold=True, color="375623", size=9)),
            "~": (PatternFill("solid", fgColor="FFEB9C"), Font(bold=True, color="7D5A00", size=9)),
            "⚠": (PatternFill("solid", fgColor="FCE4D6"), Font(bold=True, color="833C00", size=9)),
            "✗": (PatternFill("solid", fgColor="FFC7CE"), Font(bold=True, color="9C0006", size=9)),
        }
        _sfill, _sfont = next(
            (v for k, v in _SUCCESS_STYLE.items() if _succ_val.startswith(k)),
            (bg, Font(color="888888", size=9, italic=True)),
        )
        _write_cell(ws, ri, _SUCCESS_COL, _succ_val,
                    fill=_sfill, font=_sfont, align=ALIGN_C)

        # Col 24: Tipo Evento (classificazione i/ii/iii)
        _tipo_val = row.get("tipo_evento", "N/D")
        _TIPO_STYLE = {
            "i)":   (PatternFill("solid", fgColor="EDEDED"), Font(color="555555", size=9, italic=True)),
            "ii)":  (PatternFill("solid", fgColor="DDEBF7"), Font(bold=True, color="1F3864", size=9)),
            "iii)": (PatternFill("solid", fgColor="C6EFCE"), Font(bold=True, color="375623", size=9)),
            "⚠":    (PatternFill("solid", fgColor="FFF2CC"), Font(bold=True, color="7D5A00", size=9)),
        }
        _tfill, _tfont = next(
            (v for k, v in _TIPO_STYLE.items() if _tipo_val.startswith(k)),
            (bg, Font(color="888888", size=9, italic=True)),
        )
        _write_cell(ws, ri, _TIPO_COL, _tipo_val,
                    fill=_tfill, font=_tfont, align=ALIGN_C)

        # Col 25: Pendenza pre-T (%/gg) + modello fit in commento
        _slp = row.get("slope_pct")
        _mdl = row.get("fit_model", "N/D")
        if _slp is not None:
            _slp_cell = ws.cell(row=ri, column=_SLOPE_COL)
            _slp_cell.value       = _slp
            _slp_cell.number_format = '+0.000"%/gg";-0.000"%/gg";0.000"%/gg"'
            _slp_cell.alignment   = ALIGN_C
            _slp_cell.fill        = POS_FILL if _slp >= 0 else NEG_FILL
            _slp_cell.font        = Font(bold=True,
                                         color="375623" if _slp >= 0 else "9C0006",
                                         size=9)
            _slp_cell.border      = BORDER_THIN
            # modello come commento
            from openpyxl.comments import Comment
            _slp_cell.comment = Comment(f"Modello: {_mdl}", "AutoFit")
        else:
            _write_cell(ws, ri, _SLOPE_COL, "N/D",
                        fill=bg, font=Font(color="888888", size=9, italic=True), align=ALIGN_C)

        # Col 26: Predizione post-T
        _pred_val = row.get("predizione", "N/D")
        _PRED_STYLE = [
            ("↑↑", PatternFill("solid", fgColor="375623"), Font(bold=True, color="FFFFFF", size=9)),
            ("↑ ", PatternFill("solid", fgColor="C6EFCE"), Font(bold=True, color="375623", size=9)),
            ("→",  PatternFill("solid", fgColor="FFEB9C"), Font(bold=True, color="7D5A00", size=9)),
            ("↓↓", PatternFill("solid", fgColor="9C0006"), Font(bold=True, color="FFFFFF", size=9)),
            ("↓ ", PatternFill("solid", fgColor="FFC7CE"), Font(bold=True, color="9C0006", size=9)),
        ]
        _pfill, _pfont = next(
            ((f, t) for k, f, t in _PRED_STYLE if _pred_val.startswith(k)),
            (bg, Font(color="888888", size=9, italic=True)),
        )
        _write_cell(ws, ri, _PRED_COL, _pred_val,
                    fill=_pfill, font=_pfont, align=ALIGN_C)

        # Col 27: Verifica predizione
        _ver_val = row.get("verifica", "N/D")
        _VER_STYLE = [
            ("✓ Corretta",               PatternFill("solid", fgColor="C6EFCE"),
                                          Font(bold=True,  color="375623",  size=9)),
            ("✗ Errata",                 PatternFill("solid", fgColor="FFC7CE"),
                                          Font(bold=True,  color="9C0006",  size=9)),
            ("— Non correlato",          PatternFill("solid", fgColor="EDEDED"),
                                          Font(italic=True, color="555555", size=9)),
            ("⏳",                        PatternFill("solid", fgColor="FFEB9C"),
                                          Font(italic=True, color="7D5A00", size=9)),
            ("⚠",                         PatternFill("solid", fgColor="FFF2CC"),
                                          Font(bold=True,   color="7D5A00", size=9)),
        ]
        _vfill, _vfont = next(
            ((f, t) for k, f, t in _VER_STYLE if _ver_val.startswith(k)),
            (bg, Font(color="888888", size=9, italic=True)),
        )
        _write_cell(ws, ri, _VERIFICA_COL, _ver_val,
                    fill=_vfill, font=_vfont, align=ALIGN_C)

        # col 28 — Motivazione Verifica (stessa palette, testo esplicativo)
        _motiv_val  = row.get("motivazione", "")
        _motiv_font = Font(color=_vfont.color, size=9, italic=True)
        _write_cell(ws, ri, _MOTIV_COL, _motiv_val,
                    fill=_vfill, font=_motiv_font, align=ALIGN_L)

        # col 29 — Giorno Dissociazione
        _diss_val = row.get("dissociation", "N/D")
        # Palette: D+N precoce (≤7) → arancione, D+N tardivo (>7) → giallo, ">30gg" → verde,
        # "—" / "N/D" → grigio chiaro
        if isinstance(_diss_val, str) and _diss_val.startswith("D+"):
            try:
                _dn = int(_diss_val[2:])
            except ValueError:
                _dn = 99
            _diss_fill = PatternFill("solid", fgColor="FFC7CE" if _dn <= 7 else "FFEB9C")
            _diss_font = Font(bold=True,
                              color="9C0006" if _dn <= 7 else "7D5A00",
                              size=10)
        elif isinstance(_diss_val, str) and _diss_val.startswith(">"):
            _diss_fill = PatternFill("solid", fgColor="C6EFCE")
            _diss_font = Font(bold=True, color="375623", size=10)
        else:
            _diss_fill = PatternFill("solid", fgColor="F2F2F2")
            _diss_font = Font(color="888888", size=9, italic=True)
        _write_cell(ws, ri, _DISS_COL, _diss_val,
                    fill=_diss_fill, font=_diss_font, align=ALIGN_C)

        # col 30 — Pendenza Adj. XBI (%/gg excess vs mercato)
        _exc = row.get("exc_slope")
        if _exc is None:
            _write_cell(ws, ri, _EXC_SLOPE_COL, "XBI N/D",
                        fill=PatternFill("solid", fgColor="FCE4D6"),
                        font=Font(color="843C0C", size=9, italic=True), align=ALIGN_C)
        else:
            _exc_pos  = _exc >= 0
            _exc_fill = PatternFill("solid", fgColor="C6EFCE" if _exc_pos else "FFC7CE")
            _exc_font = Font(bold=True, color="375623" if _exc_pos else "9C0006", size=10)
            _exc_cell = ws.cell(row=ri, column=_EXC_SLOPE_COL, value=_exc / 100.0)
            _exc_cell.number_format = '+0.000%;-0.000%;0.000%'
            _exc_cell.fill = _exc_fill; _exc_cell.font = _exc_font
            _exc_cell.alignment = ALIGN_C

        # col 31 — Volume Build-up pre-T (rapporto 5gg / 15gg)
        _vr = row.get("vol_ratio_pre")
        if _vr is None:
            _write_cell(ws, ri, _VOL_COL, "N/D",
                        fill=PatternFill("solid", fgColor="F2F2F2"),
                        font=Font(color="888888", size=9, italic=True), align=ALIGN_C)
        else:
            if _vr >= 1.5:
                _vr_fill = PatternFill("solid", fgColor="C6EFCE")
                _vr_font = Font(bold=True, color="375623", size=10)
                _vr_txt  = f"{_vr:.2f}× ▲"
            elif _vr <= 0.7:
                _vr_fill = PatternFill("solid", fgColor="FFC7CE")
                _vr_font = Font(bold=True, color="9C0006", size=10)
                _vr_txt  = f"{_vr:.2f}× ▼"
            else:
                _vr_fill = PatternFill("solid", fgColor="FFEB9C")
                _vr_font = Font(color="7D5A00", size=10)
                _vr_txt  = f"{_vr:.2f}×"
            _write_cell(ws, ri, _VOL_COL, _vr_txt,
                        fill=_vr_fill, font=_vr_font, align=ALIGN_C)

        # col 32 — Segnale Composito ★★★ / ★★ / ★ / – / ⏳ futuro
        _sc       = _signal_score(row)
        _is_fut   = _is_future(row)

        if _is_fut:
            # Righe future: segnale pre-T disponibile ma verifica impossibile
            _fut_score = _sc  # 0-2 (max: vol + XBI, no verifica)
            _fut_label = {2: "⏳★★ pre-T", 1: "⏳★ pre-T", 0: "⏳ futuro"}.get(_fut_score, "⏳ futuro")
            _fut_fill  = PatternFill("solid", fgColor="DCE6F1")   # blu chiaro
            _fut_font  = Font(italic=True, color="1F3864", size=9)
            _write_cell(ws, ri, _SEGNALE_COL, _fut_label,
                        fill=_fut_fill, font=_fut_font, align=ALIGN_C)

            # Sfondo riga leggermente azzurro per distinguere visivamente le future
            _fut_row_fill = PatternFill("solid", fgColor="EEF4FB")
            _fut_side = Side(style="dashed", color="9DC3E6")
            _fut_top  = Side(style="thin",   color="9DC3E6")
            for ci in range(1, ncols + 1):
                _fc = ws.cell(row=ri, column=ci)
                if _fc.fill.fgColor.rgb in ("00000000", "FFFFFFFF",
                                             ODD_FILL.fgColor.rgb if ODD_FILL.fgColor else "",
                                             EVEN_FILL.fgColor.rgb if EVEN_FILL.fgColor else ""):
                    _fc.fill = _fut_row_fill
                _fc.border = Border(top=_fut_top, bottom=_fut_side,
                                    left=_fut_side, right=_fut_side)
        else:
            _sc_labels = {3: "★★★", 2: "★★", 1: "★", 0: "–"}
            _write_cell(ws, ri, _SEGNALE_COL, _sc_labels[_sc],
                        fill=_STAR_FILLS[_sc],
                        font=_STAR_FONTS[_sc],
                        align=ALIGN_C)

            # Bordo dorato per l'intera riga ★★★ (perfect match)
            if _sc == 3:
                _gold_side = Side(style="thin", color="C9A600")
                _gold_border = Border(top=_gold_side, bottom=_gold_side,
                                      left=_gold_side, right=_gold_side)
                for ci in range(1, ncols + 1):
                    ws.cell(row=ri, column=ci).border = _gold_border

        # col 33 — RSI pre-T
        _rsi = row.get("rsi_pre")
        if _rsi is None:
            _write_cell(ws, ri, _RSI_COL, "N/D",
                        fill=PatternFill("solid", fgColor="F2F2F2"),
                        font=Font(color="888888", size=9, italic=True), align=ALIGN_C)
        else:
            if _rsi > 70:
                # Overbought → predizione già abbassata
                _rsi_fill = PatternFill("solid", fgColor="FFC7CE")
                _rsi_font = Font(bold=True, color="9C0006", size=10)
                _rsi_lbl  = f"{_rsi:.0f} ⚠OB"
            elif _rsi < 30:
                # Oversold → predizione già alzata
                _rsi_fill = PatternFill("solid", fgColor="C6EFCE")
                _rsi_font = Font(bold=True, color="375623", size=10)
                _rsi_lbl  = f"{_rsi:.0f} ⚠OS"
            elif _rsi >= 60:
                _rsi_fill = PatternFill("solid", fgColor="FFEB9C")
                _rsi_font = Font(color="7D5A00", size=10)
                _rsi_lbl  = f"{_rsi:.0f}"
            elif _rsi <= 40:
                _rsi_fill = PatternFill("solid", fgColor="DDEBF7")
                _rsi_font = Font(color="1F4E79", size=10)
                _rsi_lbl  = f"{_rsi:.0f}"
            else:
                _rsi_fill = PatternFill("solid", fgColor="F2F2F2")
                _rsi_font = Font(color="404040", size=10)
                _rsi_lbl  = f"{_rsi:.0f}"
            _write_cell(ws, ri, _RSI_COL, _rsi_lbl,
                        fill=_rsi_fill, font=_rsi_font, align=ALIGN_C)

        ws.row_dimensions[ri].height = 20
        _ri += 1

    # ── Riepilogo accuratezza predizioni (2 righe sotto l'ultimo dato) ──────────
    if _last_data_row > 3:
        from openpyxl.utils import get_column_letter as _gcl
        _vcol_ltr  = _gcl(_VERIFICA_COL)   # "AA" = col 27
        _data_range = f"{_vcol_ltr}4:{_vcol_ltr}{_last_data_row}"
        _sr = _last_data_row + 2            # riga summary

        _SUM_LABEL_FILL = PatternFill("solid", fgColor="4B1C82")
        _SUM_VAL_FILL   = PatternFill("solid", fgColor="EDE7F6")
        _SUM_OK_FILL    = PatternFill("solid", fgColor="C6EFCE")
        _SUM_ERR_FILL   = PatternFill("solid", fgColor="FFC7CE")
        _SUM_PCT_FILL   = PatternFill("solid", fgColor="D9E1F2")

        _lbl_font  = Font(bold=True, color="FFFFFF", size=10)
        _val_font  = Font(bold=True, color="1A1A1A", size=10)
        _pct_font  = Font(bold=True, color="1F3864", size=11)

        # Col 1-4: etichetta principale
        ws.merge_cells(start_row=_sr, start_column=1, end_row=_sr, end_column=4)
        _write_cell(ws, _sr, 1, "Accuratezza Predizioni",
                    fill=_SUM_LABEL_FILL, font=_lbl_font, align=ALIGN_C)

        # Col 5-6: ✓ Corrette
        _write_cell(ws, _sr, 5, "✓ Corrette",
                    fill=_SUM_OK_FILL, font=Font(bold=True, color="375623", size=9), align=ALIGN_C)
        c_ok = ws.cell(row=_sr, column=6)
        c_ok.value        = f'=COUNTIF({_data_range},"✓ Corretta")'
        c_ok.fill         = _SUM_OK_FILL
        c_ok.font         = Font(bold=True, color="375623", size=10)
        c_ok.alignment    = ALIGN_C
        c_ok.border       = BORDER_THIN
        c_ok.number_format = "0"

        # Col 7-8: ✗ Errate
        _write_cell(ws, _sr, 7, "✗ Errate",
                    fill=_SUM_ERR_FILL, font=Font(bold=True, color="9C0006", size=9), align=ALIGN_C)
        c_err = ws.cell(row=_sr, column=8)
        c_err.value        = f'=COUNTIF({_data_range},"✗ Errata")'
        c_err.fill         = _SUM_ERR_FILL
        c_err.font         = Font(bold=True, color="9C0006", size=10)
        c_err.alignment    = ALIGN_C
        c_err.border       = BORDER_THIN
        c_err.number_format = "0"

        # Col 9-10: Totale valutabili
        _write_cell(ws, _sr, 9, "Totale valutabili",
                    fill=_SUM_VAL_FILL, font=Font(bold=True, color="444444", size=9), align=ALIGN_C)
        c_tot = ws.cell(row=_sr, column=10)
        _ok_addr  = f"{_gcl(6)}{_sr}"
        _err_addr = f"{_gcl(8)}{_sr}"
        c_tot.value        = f"={_ok_addr}+{_err_addr}"
        c_tot.fill         = _SUM_VAL_FILL
        c_tot.font         = _val_font
        c_tot.alignment    = ALIGN_C
        c_tot.border       = BORDER_THIN
        c_tot.number_format = "0"

        # Col 11-12: % Accuratezza
        _write_cell(ws, _sr, 11, "% Accuratezza",
                    fill=_SUM_PCT_FILL, font=Font(bold=True, color="1F3864", size=9), align=ALIGN_C)
        c_pct = ws.cell(row=_sr, column=12)
        _tot_addr = f"{_gcl(10)}{_sr}"
        c_pct.value        = f'=IF({_tot_addr}>0,{_ok_addr}/{_tot_addr},"N/D")'
        c_pct.fill         = _SUM_PCT_FILL
        c_pct.font         = _pct_font
        c_pct.alignment    = ALIGN_C
        c_pct.border       = BORDER_THIN
        c_pct.number_format = "0.0%"

        ws.row_dimensions[_sr].height = 22

    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToPage   = True
    ws.page_setup.fitToWidth  = 1


# ── Sheet "Studio": confronto fino a 5 società selezionate ───────────────────

def write_studio_sheet(
    wb: Workbook,
    metrics_list: list[dict],
    impact_rows: list[dict],
    studio_tickers: list[str],
    window: int,
    *,
    studio_benchmarks: set[str] | None = None,
) -> None:
    from openpyxl.chart import LineChart, Reference

    _bench = {str(t).strip().upper() for t in (studio_benchmarks or set())}
    _by_sym = {
        str(m.get("symbol", "")).strip().upper(): m
        for m in metrics_list
        if m.get("symbol")
    }
    # Ordine config: benchmark prima, poi watchlist biotech
    studio_metrics = [_by_sym[s] for s in studio_tickers if s in _by_sym]
    _studio_set = set(studio_tickers)
    studio_impact = [r for r in impact_rows if r.get("ticker") in _studio_set]

    if not studio_metrics:
        print("  [Studio] Nessun dato disponibile per i ticker configurati — sheet non creato.")
        return

    ws = wb.create_sheet("Studio")
    ws.sheet_properties.tabColor = "ED7D31"

    # Palette colori per le linee del grafico (fino a ~15 serie)
    _PALETTE = [
        "4472C4", "ED7D31", "70AD47", "FFC000", "7030A0",
        "C00000", "00B0F0", "92D050", "FF6B6B", "5B9BD5",
        "A5A5A5", "264478", "9E480E", "636363", "997300",
    ]

    # ── Titolo ───────────────────────────────────────────────────────────────
    total_cols = 10
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=total_cols)
    _write_cell(ws, 1, 1,
                f"Studio Titoli Selezionati  ·  {date.today().strftime('%d/%m/%Y')}",
                fill=PatternFill("solid", fgColor="1F3864"),
                font=Font(bold=True, color="FFFFFF", size=13), align=ALIGN_C)
    ws.row_dimensions[1].height = 28

    _bench_syms = [m["symbol"] for m in studio_metrics if m["symbol"] in _bench]
    _watch_syms = [m["symbol"] for m in studio_metrics if m["symbol"] not in _bench]
    ticker_str = "  ·  ".join(m["symbol"] for m in studio_metrics)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=total_cols)
    _write_cell(
        ws,
        2,
        1,
        f"Benchmark: {', '.join(_bench_syms) or '—'}   |   Confronto: {', '.join(_watch_syms) or '—'}   "
        f"(retrospective_config.json: benchmark_tickers + tickers, max watchlist "
        f"studio_max_watchlist)",
        fill=PatternFill("solid", fgColor="2E75B6"),
        font=Font(italic=True, color="FFFFFF", size=9),
        align=ALIGN_C,
    )
    ws.row_dimensions[2].height = 16

    # ── Tabella variazioni (righe 3-8) ───────────────────────────────────────
    VAR_HDR = [
        ("Ticker",          10),
        ("Società",         30),
        ("Prezzo\nAttuale", 13),
        ("Δ Giorn. %",      11),
        ("Δ 1M %",          10),
        ("Δ 3M %",          10),
        ("Δ 6M %",          10),
        ("Δ da IPO %",      12),
        ("Vol. Ann. %",     11),
        ("N° Studi",         9),
    ]
    for ci, (hdr, w) in enumerate(VAR_HDR, start=1):
        c = ws.cell(row=3, column=ci, value=hdr)
        c.fill = HEADER_FILL; c.font = HEADER_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(ci)].width = w
    ws.row_dimensions[3].height = 32

    for ri, m in enumerate(studio_metrics, start=4):
        cur     = m.get("currency", "")
        num_fmt = f'#,##0.00 "{cur}"' if cur else "#,##0.00"
        idx     = ri - 4  # 0-based per palette colori
        ticker_color = _PALETTE[idx % len(_PALETTE)]

        _is_bench = m["symbol"] in _bench
        _write_cell(
            ws,
            ri,
            1,
            f"{m['symbol']}{'  ★' if _is_bench else ''}",
            fill=PatternFill(
                "solid", fgColor="E8EAF6" if _is_bench else "D6E4F7"),
            font=Font(
                bold=True,
                size=10,
                color="283593" if _is_bench else "1F3864",
            ),
            align=ALIGN_C,
        )
        _nm = m.get("name", "")
        if _is_bench and _nm:
            _nm = f"{_nm}  (benchmark)"
        _write_cell(ws, ri, 2, _nm, font=DATA_FONT, align=ALIGN_L)
        _write_cell(ws, ri, 3,  m.get("last_price"),     font=DATA_FONT, fmt=num_fmt, align=ALIGN_R)
        _pct_cell(ws, ri,  4,  m.get("ret_1d"))
        _pct_cell(ws, ri,  5,  m.get("ret_1m"))
        _pct_cell(ws, ri,  6,  m.get("ret_3m"))
        _pct_cell(ws, ri,  7,  m.get("ret_6m"))
        _pct_cell(ws, ri,  8,  m.get("total_ret"))
        _pct_cell(ws, ri,  9,  m.get("vol_ann"), fill_base=False)
        _write_cell(ws, ri, 10, m.get("n_studies", 0),
                    font=Font(bold=True, size=10,
                              color="1F3864" if (m.get("n_studies") or 0) > 0 else "888888"),
                    align=ALIGN_C)
        ws.row_dimensions[ri].height = 18

    ws.freeze_panes = "A4"

    # ── Dati mensili per il grafico (area nascosta, riga 200+) ────────────────
    DATA_ROW_START = 200
    # Campionamento mensile per ogni ticker
    ticker_monthly: dict[str, pd.Series] = {}
    all_dates: set = set()
    for m in studio_metrics:
        close = m.get("close")
        if close is None or close.empty:
            continue
        try:
            monthly = close.resample("ME").last().dropna()
        except Exception:
            monthly = close.resample("M").last().dropna()
        ticker_monthly[m["symbol"]] = monthly
        all_dates.update(monthly.index)

    sorted_dates = sorted(all_dates)

    # Header colonne dati
    ws.cell(row=DATA_ROW_START, column=1, value="Data")
    for ci, m in enumerate(studio_metrics, start=2):
        ws.cell(row=DATA_ROW_START, column=ci, value=m["symbol"])

    # Righe prezzi mensili
    data_end_row = DATA_ROW_START
    for dr, dt in enumerate(sorted_dates, start=DATA_ROW_START + 1):
        ws.cell(row=dr, column=1, value=dt.date()).number_format = "DD/MM/YYYY"
        for ci, m in enumerate(studio_metrics, start=2):
            series = ticker_monthly.get(m["symbol"])
            if series is not None and dt in series.index:
                val = series.loc[dt]
                if not (val != val):  # nan check
                    ws.cell(row=dr, column=ci, value=round(float(val), 4))
        data_end_row = dr

    # ── LineChart ─────────────────────────────────────────────────────────────
    if data_end_row > DATA_ROW_START and len(studio_metrics) > 0:
        chart = LineChart()
        chart.title  = "Prezzo da IPO ad oggi (campionamento mensile)"
        chart.style  = 10
        chart.y_axis.title = "Prezzo"
        chart.x_axis.title = "Data"
        chart.height = 14   # cm
        chart.width  = 22   # cm
        chart.y_axis.numFmt = '#,##0.00'
        chart.x_axis.numFmt = 'dd/mm/yy'
        chart.x_axis.majorTimeUnit = "months"

        for ci, m in enumerate(studio_metrics, start=2):
            data_ref = Reference(ws, min_col=ci, max_col=ci,
                                 min_row=DATA_ROW_START, max_row=data_end_row)
            chart.add_data(data_ref, titles_from_data=True)

        dates_ref = Reference(ws, min_col=1, max_col=1,
                              min_row=DATA_ROW_START + 1, max_row=data_end_row)
        chart.set_categories(dates_ref)

        # Stile linee: spessore e colori personalizzati
        for i, series in enumerate(chart.series):
            series.smooth = True
            series.graphicalProperties.line.width  = 18000   # 2pt in EMU
            series.graphicalProperties.line.solidFill = _PALETTE[i % len(_PALETTE)]

        ws.add_chart(chart, "L2")   # Chart a destra della tabella

    # ── Sezione Impatto Completion Date ───────────────────────────────────────
    impact_sec_row = 10

    ws.merge_cells(start_row=impact_sec_row, start_column=1,
                   end_row=impact_sec_row, end_column=11)
    _write_cell(ws, impact_sec_row, 1,
                f"Impatto Completion Date Studi Clinici  ·  Finestra ±{window} giorni",
                fill=PatternFill("solid", fgColor="375623"),
                font=Font(bold=True, color="FFFFFF", size=11), align=ALIGN_C)
    ws.row_dimensions[impact_sec_row].height = 24

    IMP_HDR = [
        ("Ticker",               10),
        ("Società",              26),
        ("Fase",                 12),
        ("Completion Date",      14),
        ("Titolo Studio",        48),
        ("Status",               14),
        (f"T-{window}d",         12),
        ("T (completion)",       13),
        (f"T+{window}d",         12),
        (f"Δ pre {window}d %",   12),
        (f"Δ post {window}d %",  12),
    ]
    imp_hdr_row = impact_sec_row + 1
    for ci, (hdr, w) in enumerate(IMP_HDR, start=1):
        c = ws.cell(row=imp_hdr_row, column=ci, value=hdr)
        c.fill = PatternFill("solid", fgColor="375623")
        c.font = HEADER_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(ci)].width = max(
            float(ws.column_dimensions[get_column_letter(ci)].width or 0), w
        )
    ws.row_dimensions[imp_hdr_row].height = 24

    if not studio_impact:
        ws.merge_cells(start_row=imp_hdr_row + 1, start_column=1,
                       end_row=imp_hdr_row + 1, end_column=11)
        _write_cell(ws, imp_hdr_row + 1, 1,
                    "Nessun dato di impatto disponibile per i ticker selezionati.",
                    font=Font(italic=True, color="888888", size=10), align=ALIGN_C)
    else:
        for ri, row in enumerate(studio_impact, start=imp_hdr_row + 1):
            bg  = ODD_FILL if ri % 2 == 0 else EVEN_FILL
            sym = row["ticker"]
            cur = row.get("currency", "")
            num_fmt = f'#,##0.00 "{cur}"' if cur else "#,##0.00"

            _write_cell(ws, ri, 1,  sym,
                        fill=PatternFill("solid", fgColor="D6EAD6"),
                        font=Font(bold=True, size=10, color="375623"), align=ALIGN_C)
            _write_cell(ws, ri, 2,  row.get("name", ""),       fill=bg, font=DATA_FONT, align=ALIGN_L)
            _write_cell(ws, ri, 3,  row.get("phase", "—"),     fill=bg,
                        font=Font(bold=True, size=10), align=ALIGN_C)
            _write_cell(ws, ri, 4,  row.get("comp_date"),      fill=bg,
                        font=DATA_FONT, fmt="DD/MM/YYYY", align=ALIGN_C)
            _write_cell(ws, ri, 5,  row.get("title", "—"),     fill=bg, font=DATA_FONT, align=WRAP_L)
            _write_cell(ws, ri, 6,  row.get("status", "—"),    fill=bg, font=DATA_FONT, align=ALIGN_C)
            _write_cell(ws, ri, 7,  row.get("p_before"),       fill=bg,
                        font=DATA_FONT, fmt=num_fmt, align=ALIGN_R)
            _write_cell(ws, ri, 8,  row.get("p_at"),           fill=bg,
                        font=DATA_FONT, fmt=num_fmt, align=ALIGN_R)
            _write_cell(ws, ri, 9,  row.get("p_after"),        fill=bg,
                        font=DATA_FONT, fmt=num_fmt, align=ALIGN_R)
            _pct_cell(ws, ri, 10, row.get("ret_pre"))
            _pct_cell(ws, ri, 11, row.get("ret_post"))
            ws.row_dimensions[ri].height = 20

    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToPage   = True
    ws.page_setup.fitToWidth  = 1


# ── Main ──────────────────────────────────────────────────────────────────────

def _fetch_studio_tickers_only(
    config_path: str,
) -> tuple[list[dict], list[dict], list[str], set[str]]:
    """
    Modalità standalone: scarica solo i ticker definiti in retrospective_config.json.
    Restituisce (metrics_list, impact_rows=[], studio_tickers, benchmark_set).
    """
    studio_tickers, bench_set = load_studio_symbols(
        workbook_path=STANDALONE_EXCEL if os.path.isfile(STANDALONE_EXCEL) else None,
        config_path=RETROSPECTIVE_CONFIG_JSON,
    )

    if not studio_tickers:
        print(
            "  [ERR] Nessun ticker — foglio «Studio watchlist» o retrospective_config.json."
        )
        return [], [], [], set()
    metrics_list: list[dict] = []
    for i, sym in enumerate(studio_tickers, start=1):
        print(f"  ({i}/{len(studio_tickers)}) {sym}…", end=" ", flush=True)
        hist = fetch_history_cached(sym, force=FORCE_CACHE)
        if hist.empty:
            print("nessun dato")
            continue
        info = fetch_info_cached(sym, fallback={"longName": sym}, force=FORCE_CACHE)
        m = compute_metrics(sym, hist, info)
        m["n_studies"] = 0
        metrics_list.append(m)
        dur = (m["last_date"] - m["first_date"]).days // 365 \
              if m.get("first_date") and m.get("last_date") else "?"
        print(f"OK  ({dur}y  ret={m.get('total_ret', 0):.0f}%)" if isinstance(dur, int)
              else f"OK  ret={m.get('total_ret', 0):.0f}%")
        time.sleep(0.05)   # ridotto: la cache non fa rete

    return metrics_list, [], studio_tickers, bench_set  # nessun dato clinico in standalone


def main():
    mode_label = (
        "STANDALONE -> studio_preview.xlsx" if STANDALONE else "ORCHESTRATOR"
    )
    print("=" * 62)
    print(f"  Biotech Retrospective Fetcher | window={WINDOW}gg")
    print(f"  Modalita: {mode_label}")
    print("=" * 62)

    if STUDIO_ONLY:
        _xlsx = STANDALONE_EXCEL if STANDALONE else OUTPUT_EXCEL
        refresh_studio_sheet_only(_xlsx, WINDOW)
        return

    # ── PERCORSO STANDALONE ────────────────────────────────────────────────────
    if STANDALONE:
        print(f"\n[1/2] Download ticker da retrospective_config.json…")
        metrics_list, impact_rows, studio_tickers, bench_set = _fetch_studio_tickers_only(
            RETROSPECTIVE_CONFIG_JSON
        )
        if not metrics_list:
            return

        print(f"\n[2/2] Genero {STANDALONE_EXCEL}…")
        os.makedirs(DATA_DIR, exist_ok=True)
        wb = Workbook()
        wb.remove(wb.active)   # rimuovi il foglio vuoto default

        write_studio_watchlist_sheet(wb)
        write_riepilogo_sheet(wb, metrics_list)
        write_studio_sheet(
            wb,
            metrics_list,
            impact_rows,
            studio_tickers,
            WINDOW,
            studio_benchmarks=bench_set,
        )

        wb.save(STANDALONE_EXCEL)
        print(f"\n✅ File standalone salvato: {STANDALONE_EXCEL}")
        print(f"   Sheet 'Riepilogo IPO'   → {len(metrics_list)} righe")
        print(f"   Sheet 'Studio'          → {len(studio_tickers)} ticker")
        print(f"   Sheet totali            → {len(wb.sheetnames)}: {', '.join(wb.sheetnames)}")
        print(f"\n   ℹ  Apri {STANDALONE_EXCEL} per verificare.")
        print(f"      Quando sei soddisfatto, esegui senza --standalone per aggiornare il file principale.")
        return

    # ── PERCORSO ORCHESTRATOR (default) ───────────────────────────────────────
    print(f"\n[1/4] Carico dati da {INPUT_JSON}…")
    fin_df, clin_df = load_orchestrator()

    sym_col  = _pick(_SYM_CANDIDATES,  fin_df)
    name_col = _pick(_NAME_CANDIDATES, fin_df)
    if sym_col is None or fin_df.empty:
        print("  [ERR] Nessun ticker trovato nel financial_df. Esco.")
        return

    tickers = fin_df[sym_col].dropna().astype(str).str.strip().str.upper().unique().tolist()
    print(f"  → {len(tickers)} ticker trovati: {', '.join(tickers[:10])}"
          f"{'…' if len(tickers) > 10 else ''}")

    # Conta studi per ticker
    n_studies_map: dict[str, int] = {}
    if not clin_df.empty:
        tc = _pick(["ticker", "symbol", "Ticker"], clin_df)
        if tc:
            counts = (clin_df[tc].astype(str).str.strip().str.upper()
                      .value_counts().to_dict())
            n_studies_map = counts

    # 2. Fetch storia per ogni ticker (con cache su disco)
    cache_label = " [FORCE — cache ignorata]" if FORCE_CACHE else \
                  f" [cache in {CACHE_DIR}]"
    print(f"\n[2/4] Scarico storia prezzi{cache_label}…")
    metrics_list: list[dict] = []
    metrics_map:  dict[str, dict] = {}
    # Lookup nome azienda per ticker (evita filtro DataFrame ad ogni iterazione)
    if not fin_df.empty:
        _sym_ser = fin_df[sym_col].astype(str).str.strip().str.upper()
        _name_ser = (
            fin_df[name_col].fillna("").astype(str) if name_col and name_col in fin_df.columns
            else pd.Series([""] * len(fin_df), index=fin_df.index)
        )
        _name_map = {s: n for s, n in zip(_sym_ser.tolist(), _name_ser.tolist()) if s}
    else:
        _name_map = {}

    _workers = min(8, max(2, (os.cpu_count() or 4)))

    def _process_sym(sym: str):
        hist = fetch_history_cached(sym, force=FORCE_CACHE)
        if hist.empty:
            return sym, None
        info_fallback = {"longName": str(_name_map.get(sym, sym) or sym)}
        info = fetch_info_cached(sym, fallback=info_fallback, force=FORCE_CACHE)
        m = compute_metrics(sym, hist, info)
        m["n_studies"] = n_studies_map.get(sym, 0)
        return sym, m

    print(f"  → Parallel workers: {_workers}")
    with ThreadPoolExecutor(max_workers=_workers) as ex:
        fut_to_sym = {ex.submit(_process_sym, sym): sym for sym in tickers}
        for i, fut in enumerate(as_completed(fut_to_sym), start=1):
            sym = fut_to_sym[fut]
            try:
                _sym, m = fut.result()
            except Exception as _e:
                print(f"  ({i}/{len(tickers)}) {sym}… errore: {_e}")
                continue
            if m is None:
                print(f"  ({i}/{len(tickers)}) {_sym}… nessun dato")
                continue
            metrics_list.append(m)
            metrics_map[_sym] = m
            dur = (m.get("last_date") - m.get("first_date")).days // 365 \
                  if m.get("first_date") and m.get("last_date") else "?"
            if isinstance(dur, int):
                _status = f"OK  ({dur}y  ret={m.get('total_ret', 0):.0f}%)"
            else:
                _status = f"OK  ret={m.get('total_ret', 0):.0f}%"
            print(f"  ({i}/{len(tickers)}) {_sym}… {_status}")

    print(f"  → {len(metrics_list)} ticker con dati validi")

    # 3. Calcolo impatto clinico
    print(f"\n[3/4] Calcolo impatto completion date (±{WINDOW}gg)…")
    impact_rows = compute_clinical_impact(clin_df, metrics_map, WINDOW)
    print(f"  → {len(impact_rows)} righe studio con dati di prezzo")

    # 4. Aggiunta sheet all'Excel principale
    print(f"\n[4/4] Aggiunta sheet a {OUTPUT_EXCEL}…")

    if not os.path.exists(OUTPUT_EXCEL):
        print(f"  [ERR] File non trovato: {OUTPUT_EXCEL}")
        print("  Esegui prima 'python data_orchestrator.py' per creare il file Excel.")
        return

    studio_tickers, studio_bench = load_studio_symbols(workbook_path=OUTPUT_EXCEL)
    if not studio_tickers:
        print(
            f"  [INFO] Nessun ticker Studio — compila il foglio «{STUDIO_WATCHLIST_SHEET}» "
            f"nel workbook o retrospective_config.json.",
            flush=True,
        )

    # Aggiungi alla fetch i ticker dello studio non ancora scaricati
    if studio_tickers:
        extra = [t for t in studio_tickers if t not in metrics_map]
        if extra:
            print(f"  → Download aggiuntivo per {extra}…")
            for sym in extra:
                print(f"  ({sym})…", end=" ", flush=True)
                hist = fetch_history_cached(sym, force=FORCE_CACHE)
                if hist.empty:
                    print("nessun dato")
                    continue
                info = fetch_info_cached(sym, fallback={"longName": sym}, force=FORCE_CACHE)
                m = compute_metrics(sym, hist, info)
                m["n_studies"] = n_studies_map.get(sym, 0)
                metrics_list.append(m)
                metrics_map[sym] = m
                print(f"OK  ret={m.get('total_ret', 0):.0f}%")

    try:
        wb = _load_workbook_for_retro(OUTPUT_EXCEL)
    except PermissionError:
        print(
            "\n[ERRORE] Impossibile aprire il file Excel:\n"
            f"  {OUTPUT_EXCEL}\n"
            "  → Chiudi Excel sul file, oppure usa: python fetch_retrospective.py --studio-only\n",
        )
        return

    write_studio_watchlist_sheet(wb)

    for nome in _RETRO_SHEETS_REWRITE:
        if nome in wb.sheetnames:
            del wb[nome]
            print(f"  → Sheet '{nome}' rimosso (sarà riscritto)")

    write_riepilogo_sheet(wb, metrics_list)

    if studio_tickers:
        write_studio_sheet(
            wb,
            metrics_list,
            impact_rows,
            studio_tickers,
            WINDOW,
            studio_benchmarks=studio_bench,
        )

    try:
        out_path = _save_workbook_staged(wb, OUTPUT_EXCEL, log_label="[Retro]")
    finally:
        wb.close()

    # ── Foglio 🔄 Aggiorna + pulsante (solo se pywin32 disponibile) ───────────
    print("\n[Launcher] Aggiunta pulsante di aggiornamento al file output...")
    if not STUDIO_ONLY:
        try:
            _inject_refresh_button(out_path)
        except Exception as _inj:
            print(f"  [Launcher] Pulsante Aggiorna non aggiunto: {_inj}")

    print(f"\n✅ Sheet aggiunti a: {out_path}")
    print(f"   Sheet 'Riepilogo IPO'     → {len(metrics_list)} righe")
    if studio_tickers:
        n_imp = sum(1 for r in impact_rows if r.get("ticker") in studio_tickers)
        print(f"   Sheet 'Studio'            → {len(studio_tickers)} ticker  |  {n_imp} eventi clinici")
    print(f"   Sheet totali nel file     → {len(wb.sheetnames)}: {', '.join(wb.sheetnames)}")


def compute_previsioni(clin_df, metrics_map: dict, force: bool = False) -> list[dict]:
    """
    Calcola previsioni live per gli studi con completion date FUTURA.
    Usa 'oggi' come punto di osservazione (T_ref): la pendenza, RSI e volume
    sono calcolati fino a oggi, indipendentemente dalla data dell'evento.
    Il livello di affidabilità sale man mano che T si avvicina.
    """
    from datetime import date as _date, timedelta as _td
    today    = _date.today()
    today_ts = pd.Timestamp(today)

    # ── Rilevamento colonne ──────────────────────────────────────────────────
    ticker_col = next((c for c in clin_df.columns
                       if "symbol" in c.lower() or "ticker" in c.lower()), None)
    date_col   = next((c for c in clin_df.columns
                       if c.lower() in _DATE_CANDIDATES
                       or any(k in c.lower() for k in ("completion", "date", "data"))), None)
    phase_col  = next((c for c in clin_df.columns
                       if "phase" in c.lower() or "fase" in c.lower()), None)
    title_col  = next((c for c in clin_df.columns
                       if "title" in c.lower() or "titolo" in c.lower()
                       or "brief" in c.lower()), None)
    print(f"  [previsioni] clin_df colonne: {list(clin_df.columns)}")
    print(f"  [previsioni] ticker_col={ticker_col!r}  date_col={date_col!r}")

    if not ticker_col or not date_col:
        print("  [previsioni] WARN: colonne ticker/date non trovate — sheet saltato")
        return []

    # ── Carica XBI una volta ─────────────────────────────────────────────────
    _xbi_close = _fetch_xbi_close(force=force)

    # ── Mappa affidabilità base per fascia temporale ─────────────────────────
    def _base_aff(days: int) -> int:
        if days <= 3:  return 90
        if days <= 7:  return 78
        if days <= 30: return 62
        if days <= 60: return 48
        return 35

    def _livello(days: int) -> str:
        if days <= 3:  return "🎯 Molto buono"
        if days <= 7:  return "📈 Buono"
        if days <= 30: return "📊 Basso"
        if days <= 60: return "⏳ Molto basso"
        return "⬜ Troppo presto"

    # ── Helper: slope su n giorni via prezzi storici ──────────────────────────
    def _slope_n_ret(close_ser: "pd.Series", n: int) -> "float | None":
        try:
            import numpy as _np
            s = close_ser.dropna().tail(n)
            if len(s) < max(3, n // 2): return None
            x  = _np.arange(len(s), dtype=float)
            y  = s.values.astype(float)
            p0 = y[0] if y[0] > 0 else 1.0
            c  = _np.polyfit(x, (y / p0 - 1.0) * 100.0, 1)
            return round(float(c[0]), 4)
        except Exception: return None

    # ── Helper: accelerazione volume (ultimi 5gg vs 5gg precedenti) ──────────
    def _vol_accel_ret(volume_ts: "pd.Series | None", ref_ts: "pd.Timestamp") -> "float | None":
        try:
            if volume_ts is None or volume_ts.empty: return None
            v = volume_ts.loc[volume_ts.index <= ref_ts].dropna()
            if len(v) < 10: return None
            last5 = float(v.tail(5).mean())
            prev5 = float(v.tail(10).head(5).mean())
            return round(last5 / prev5, 2) if prev5 > 0 else None
        except Exception: return None

    # ── Helper: run-up % ultimi 30gg ─────────────────────────────────────────
    def _run_up_ret(close_ser: "pd.Series", n_days: int = 30) -> "float | None":
        try:
            s = close_ser.dropna()
            if len(s) < max(5, n_days // 3): return None
            ref = float(s.tail(n_days).iloc[0])
            cur = float(s.iloc[-1])
            return round((cur / ref - 1.0) * 100.0, 1) if ref > 0 else None
        except Exception: return None

    # ── Helper: estrae numero di fase dalla stringa ───────────────────────────
    _PH_PRIOR_RET = {3: +5, 2: -10, 1: 0}
    def _phase_num_ret(ph: str) -> "int | None":
        ph = ph.upper()
        if any(x in ph for x in ["3", "III"]): return 3
        if any(x in ph for x in ["2", "II"]):  return 2
        if any(x in ph for x in ["1", "I"]):   return 1
        return None

    # ── Helper: prossimità al massimo 52 settimane ────────────────────────────
    def _52wk_proximity_ret(close_ser: "pd.Series") -> "float | None":
        try:
            s = close_ser.dropna()
            if len(s) < 20: return None
            hi  = float(s.tail(252).max())
            cur = float(s.iloc[-1])
            return round(cur / hi, 3) if hi > 0 else None
        except Exception: return None

    # ── Helper: divergenza volume-prezzo ─────────────────────────────────────
    def _vol_price_div_ret(close_ser: "pd.Series",
                           vol_ser: "pd.Series | None", n: int = 20) -> int:
        try:
            import numpy as _np2
            if vol_ser is None or vol_ser.empty: return 0
            p_sl = _slope_n_ret(close_ser, n)
            raw_vol = vol_ser.dropna().astype(float).tail(n)
            if len(raw_vol) < max(3, n // 2): return 0
            xv = _np2.arange(len(raw_vol), dtype=float)
            yv = raw_vol.values
            v_sl = float(_np2.polyfit(xv, yv / (yv.mean() or 1.0), 1)[0]) * 100.0
            if p_sl is None: return 0
            if p_sl < -0.3 and v_sl >  0.5: return +1
            if p_sl >  0.3 and v_sl < -0.5: return -1
            return 0
        except Exception: return 0

    # ── Modello ensemble v3 ───────────────────────────────────────────────────
    def _ensemble_ret(
        ph_num, exc_slope, slope_pct, rsi_val,
        vol_ratio, vol_accel, run_up, slope_5d, slope_20d,
        run_up_7d=None, ath_prox=None, vol_px_div=0,
    ) -> "tuple[str, list[str]]":
        """Ensemble v3 — identico a data_orchestrator._direction_ensemble."""
        notes: list[str] = []
        if ph_num == 2:
            notes.append("Ph2: neutro (70% fail storico)")
            return "→ Stabile", notes

        bull = 0; bear = 0
        bull_r: list[str] = []; bear_r: list[str] = []

        # 1. Slope excess vs XBI
        _s = exc_slope if exc_slope is not None else slope_pct
        if _s is not None:
            if   _s >=  1.5: bull += 2; bull_r.append(f"slope+{_s:+.2f}")
            elif _s >=  0.5: bull += 1; bull_r.append(f"slope+{_s:+.2f}")
            elif _s <= -1.5: bear += 2; bear_r.append(f"slope{_s:+.2f}")
            elif _s <= -0.5: bear += 1; bear_r.append(f"slope{_s:+.2f}")

        # 2. RSI solo estremi (zona neutra rimossa)
        if rsi_val is not None:
            if   rsi_val > 72: bear += 2; bear_r.append(f"RSI OB {rsi_val:.0f}")
            elif rsi_val > 65: bear += 1; bear_r.append(f"RSI alto {rsi_val:.0f}")
            elif rsi_val < 28: bull += 2; bull_r.append(f"RSI OS {rsi_val:.0f}")
            elif rsi_val < 35: bull += 1; bull_r.append(f"RSI basso {rsi_val:.0f}")

        # 3. Volume con cap combinato a 3
        _vbull = 0; _vbear = 0
        if vol_ratio is not None:
            if   vol_ratio >= 2.0: _vbull += 2; bull_r.append(f"vol {vol_ratio:.1f}x")
            elif vol_ratio >= 1.5: _vbull += 1; bull_r.append(f"vol {vol_ratio:.1f}x")
            elif vol_ratio <  0.6: _vbear += 1; bear_r.append(f"vol↓ {vol_ratio:.1f}x")
        if vol_accel is not None:
            if   vol_accel >= 2.0: _vbull += 2; bull_r.append(f"va {vol_accel:.1f}x")
            elif vol_accel >= 1.5: _vbull += 1; bull_r.append(f"va {vol_accel:.1f}x")
            elif vol_accel <  0.6: _vbear += 1; bear_r.append(f"va↓ {vol_accel:.1f}x")
        bull += min(_vbull, 3)
        bear += min(_vbear, 2)

        # 4. TF alignment solo con soglia minima
        if (slope_5d is not None and slope_20d is not None
                and abs(slope_5d) > 0.3 and abs(slope_20d) > 0.3):
            if   slope_5d > 0 and slope_20d > 0: bull += 1; bull_r.append("TF↑↑")
            elif slope_5d < 0 and slope_20d < 0: bear += 1; bear_r.append("TF↓↓")

        # 5. Run-up contrarian (Phase 3 triplo)
        if run_up is not None:
            _ph3 = (ph_num == 3)
            if   run_up >  20: w = 3 if _ph3 else 2; bear += w; bear_r.append(f"BTR+{run_up:.0f}%")
            elif run_up >  12: bear += 1; bear_r.append(f"run+{run_up:.0f}%")
            elif run_up < -20: w = 3 if _ph3 else 2; bull += w; bull_r.append(f"CTR{run_up:.0f}%")
            elif run_up < -12: bull += 1; bull_r.append(f"dip{run_up:.0f}%")

        # 6. Drift quality (accumulo graduale vs spike)
        if run_up is not None and run_up_7d is not None and abs(run_up) >= 8:
            if run_up > 0:
                r7 = abs(run_up_7d) / abs(run_up) if abs(run_up) > 0 else 0
                if r7 < 0.35:  bull += 1; bull_r.append(f"drift graduale {run_up:.0f}%")
                elif r7 > 0.70: bear += 1; bear_r.append(f"spike7gg {run_up_7d:.0f}%")
            elif run_up < 0:
                r7 = abs(run_up_7d) / abs(run_up) if abs(run_up) > 0 else 0
                if r7 < 0.35:  bear += 1; bear_r.append(f"sell graduale {run_up:.0f}%")
                elif r7 > 0.70: bull += 1; bull_r.append(f"panic7gg {run_up_7d:.0f}%")

        # 7. Prossimità massimo 52 settimane
        if ath_prox is not None:
            if   ath_prox >= 0.92: bear += 1; bear_r.append(f"vicino ATH {ath_prox:.0%}")
            elif ath_prox <= 0.45: bull += 1; bull_r.append(f"lontano ATH {ath_prox:.0%}")

        # 8. Divergenza volume-prezzo
        if vol_px_div == +1: bull += 1; bull_r.append("div vol↑px↓ (accum.)")
        elif vol_px_div == -1: bear += 1; bear_r.append("div vol↓px↑ (distrib.)")

        net = bull - bear
        if   net >=  4: pred = "↑↑ Forte crescita"; notes = bull_r[:4]
        elif net ==  3: pred = "↑ Crescita lieve";  notes = bull_r[:3]
        elif net <= -4: pred = "↓↓ Calo forte";     notes = bear_r[:4]
        elif net == -3: pred = "↓ Calo lieve";      notes = bear_r[:3]
        else:           pred = "→ Stabile";         notes = [f"neutro (B{bull}/S{bear})"]

        notes.append(f"[B{bull} S{bear} net{net:+d}]")
        return pred, notes

    rows: list[dict] = []
    df = clin_df.copy()
    df["_sym"]  = df[ticker_col].astype(str).str.strip().str.upper()
    df["_date"] = pd.to_datetime(df[date_col], errors="coerce").dt.date

    _cnt_tot     = len(df)
    _cnt_future  = 0
    _cnt_no_map  = 0
    _cnt_no_close= 0
    _cnt_no_price= 0

    for _, row in df.iterrows():
        sym = row["_sym"]
        cd  = row["_date"]
        if pd.isna(cd) or not isinstance(cd, _date) or cd <= today:
            continue                                # solo eventi futuri
        _cnt_future += 1

        m = metrics_map.get(sym)
        if m is None:
            _cnt_no_map += 1
            continue

        close  = m.get("close")
        volume = m.get("volume")
        if close is None or close.empty:
            _cnt_no_close += 1
            continue

        days_to_t = (cd - today).days

        # ── Prezzo di riferimento = oggi ────────────────────────────────────
        p_today = _price_at(close, today)
        if p_today is None or p_today <= 0:
            _cnt_no_price += 1
            continue

        # ── Curva pre-T (da oggi a 20 gg fa) ────────────────────────────────
        _xp = [-20, -10, -7, -5, -1, 0]
        _yp = [_price_at(close, today - _td(days=d)) for d in [20, 10, 7, 5, 1]]
        _yp.append(p_today)
        slope_pct, fit_model, fit_r2 = _fit_pre_curve(_xp, _yp, p_today)

        # ── Segnali base ─────────────────────────────────────────────────────
        beta      = m.get("beta")
        vol_ratio = _volume_ratio_pre(volume, today_ts)
        exc_slope = _market_excess_slope(close, today_ts, _xbi_close)
        rsi_val   = _rsi_at_t(close, today_ts)

        # ── Segnali tecnici ───────────────────────────────────────────────────
        close_to_today = close.loc[close.index <= today_ts]
        slope_5d    = _slope_n_ret(close_to_today, 5)
        slope_20d   = _slope_n_ret(close_to_today, 20)
        vol_accel   = _vol_accel_ret(volume, today_ts)
        run_up      = _run_up_ret(close_to_today, 30)
        run_up_7d   = _run_up_ret(close_to_today, 7)
        ath_prox    = _52wk_proximity_ret(close_to_today)
        vpd         = _vol_price_div_ret(close_to_today, volume)
        phase_str   = str(row[phase_col]).strip() if phase_col else ""
        ph_num      = _phase_num_ret(phase_str)

        # Multi-timeframe alignment
        slope_aligned: "bool | None" = None
        if slope_5d is not None and slope_20d is not None:
            slope_aligned = (slope_5d > 0) == (slope_20d > 0)

        # ── Predizione raw (momentum, solo diagnostica) ──────────────────────
        _slope_for = exc_slope if exc_slope is not None else slope_pct
        pred_raw   = _predizione_label(_slope_for, beta=beta)

        # ── Modello ensemble v3 ───────────────────────────────────────────────
        pred_adj, _ens_notes = _ensemble_ret(
            ph_num, exc_slope, slope_pct, rsi_val,
            vol_ratio, vol_accel, run_up, slope_5d, slope_20d,
            run_up_7d=run_up_7d, ath_prox=ath_prox, vol_px_div=vpd,
        )
        adj_notes = "; ".join(_ens_notes)

        # ── Calcolo affidabilità ─────────────────────────────────────────────
        aff = _base_aff(days_to_t)
        if vol_ratio  is not None and vol_ratio >= 1.5:        aff += 5
        if exc_slope  is not None and exc_slope > 0:           aff += 5
        elif exc_slope is None and slope_pct is not None \
                and slope_pct > 0:                             aff += 3
        if rsi_val    is not None:
            if 30 <= rsi_val <= 70:                            aff += 3
            if rsi_val > 70:                                   aff -= 8
            elif rsi_val < 30:                                 aff -= 5
        if fit_r2     is not None and fit_r2 < R2_MIN:         aff -= 15
        # ── Nuovi segnali su affidabilità ─────────────────────────────────────
        if vol_accel is not None:
            if   vol_accel >= 2.0: aff += 8
            elif vol_accel >= 1.5: aff += 4
            elif vol_accel <  0.7: aff -= 4
        if slope_aligned is True:   aff += 5
        elif slope_aligned is False: aff -= 5
        if ph_num is not None:
            aff += _PH_PRIOR_RET.get(ph_num, 0)
        aff = min(95, max(20, aff))

        rows.append({
            "ticker":        sym,
            "name":          m.get("name", ""),
            "phase":         phase_str,
            "phase_num":     ph_num,
            "title":         str(row[title_col]).strip() if title_col else "",
            "comp_date":     cd,
            "days_to_t":     days_to_t,
            "livello":       _livello(days_to_t),
            "affidabilita":  aff,
            "predizione":    pred_adj,
            "pred_raw":      pred_raw,
            "adj_notes":     adj_notes if isinstance(adj_notes, str) else "; ".join(adj_notes),
            "rsi":           rsi_val,
            "exc_slope":     exc_slope,
            "slope_pct":     slope_pct,
            "vol_ratio":     vol_ratio,
            "fit_r2":        fit_r2,
            # segnali ensemble v3
            "slope_5d":      slope_5d,
            "slope_20d":     slope_20d,
            "slope_aligned": slope_aligned,
            "vol_accel":     vol_accel,
            "run_up_30d":    run_up,
            "run_up_7d":     run_up_7d,
            "ath_prox":      ath_prox,
            "vol_price_div": vpd,
        })

    rows.sort(key=lambda r: r["days_to_t"])
    print(
        f"  [previsioni] Diagnostica filtri:\n"
        f"    Righe totali nel clin_df        : {_cnt_tot}\n"
        f"    → con data futura (cd > oggi)   : {_cnt_future}\n"
        f"    → scartate: ticker non in map   : {_cnt_no_map}\n"
        f"    → scartate: close mancante      : {_cnt_no_close}\n"
        f"    → scartate: prezzo oggi assente : {_cnt_no_price}\n"
        f"    ✅ eventi con segnale calcolato  : {len(rows)}"
    )
    return rows


# ────────────────────────────────────────────────────────────────────────────
def write_previsioni_sheet(
    wb: Workbook,
    prev_rows: list[dict],
    calib_path: str | None = None,
) -> None:
    """Sheet 'Previsioni Trial': segnali live per eventi futuri, 4 livelli."""
    from openpyxl.utils import get_column_letter

    SHEET_NAME = "Previsioni Trial"
    ws = wb.create_sheet(SHEET_NAME)
    ws.sheet_properties.tabColor = "ED7D31"   # arancione

    # ── Colonne ──────────────────────────────────────────────────────────────
    COLS = [
        ("Ticker",          10, ALIGN_C),   # 1
        ("Società",         28, ALIGN_L),   # 2
        ("Fase Clinica",    14, ALIGN_C),   # 3
        ("Completion\nDate",14, ALIGN_C),   # 4
        ("Giorni\na T",     9,  ALIGN_C),   # 5
        ("Livello\nSegnale",16, ALIGN_C),   # 6
        ("Affidabilità\n%", 12, ALIGN_C),   # 7
        ("Predizione\nPost-T",18,ALIGN_C),  # 8
        ("Pred.\nRaw",      16, ALIGN_C),   # 9
        ("RSI\noggi",       9,  ALIGN_C),   # 10
        ("Slope\nAdj. XBI", 13, ALIGN_C),   # 11
        ("Vol.\nBuild-up",  12, ALIGN_C),   # 12
        ("Motivo\nCorrezione",38,ALIGN_L),  # 13
    ]
    ncols = len(COLS)

    _today_str  = date.today().strftime("%d/%m/%Y")
    n_futuri    = len(prev_rows)
    n_pos       = sum(1 for r in prev_rows if r["predizione"].startswith("↑"))
    n_neg       = sum(1 for r in prev_rows if r["predizione"].startswith("↓"))
    n_stable    = n_futuri - n_pos - n_neg

    # ── Riga titolo ──────────────────────────────────────────────────────────
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    _write_cell(ws, 1, 1,
                f"Previsioni Trial  ·  {_today_str}  ·  {n_futuri} eventi futuri  "
                f"·  ↑ {n_pos} positivi  →  {n_stable} stabili  ↓ {n_neg} negativi",
                fill=PatternFill("solid", fgColor="843C0C"),
                font=TITLE_FONT, align=ALIGN_C)
    ws.row_dimensions[1].height = 28

    # ── Intestazioni + descrizioni ───────────────────────────────────────────
    _HDR = PatternFill("solid", fgColor="843C0C")
    _HDR_LVL  = PatternFill("solid", fgColor="4B1C82")
    _HDR_AFF  = PatternFill("solid", fgColor="375623")
    _HDR_PRED = PatternFill("solid", fgColor="1F3864")
    _FILLS_HDR = [_HDR, _HDR, _HDR, _HDR, _HDR,
                  _HDR_LVL, _HDR_AFF, _HDR_PRED, _HDR_PRED,
                  _HDR_PRED, _HDR_PRED, _HDR_PRED, _HDR_PRED]

    descs = [
        "Simbolo ticker Yahoo Finance",
        "Nome completo della società",
        "Fase dello studio (I / II / III)",
        "Data di completion primaria",
        "Giorni lavorativi all'evento — più basso = segnale più affidabile",
        "🎯 ≤3gg  📈 4–7gg  📊 8–30gg  ⏳ 31–60gg  ⬜ >60gg",
        "Affidabilità % = base(giorni) ± bonus(vol/slope/RSI) ± malus(R²/RSI estremo). Max 95%.",
        "Predizione direzione post-T già corretta per RSI e buy-the-rumor",
        "Predizione grezza (solo pendenza, senza correzioni RSI/BTR)",
        "RSI-14 a oggi. >70 ⚠OB (overbought) / <30 ⚠OS (oversold)",
        "Slope pendenza al netto dell'ETF XBI (%/gg). Positivo = alpha vs settore.",
        "Volume 5gg ÷ media 15gg precedenti. ≥1.5× ▲ = build-up accumulo",
        "Motivazione correzione RSI / buy-the-rumor (vuoto se nessuna correzione applicata)",
    ]

    for ci, ((hdr, w, al), desc, hfill) in enumerate(zip(COLS, descs, _FILLS_HDR), start=1):
        _write_cell(ws, 2, ci, hdr,  fill=hfill,    font=HEADER_FONT, align=ALIGN_C)
        _write_cell(ws, 3, ci, desc, fill=DESC_FILL, font=DESC_FONT,   align=ALIGN_C)
        ws.column_dimensions[get_column_letter(ci)].width = w

    ws.row_dimensions[2].height = 28
    ws.row_dimensions[3].height = 46
    ws.freeze_panes = "A4"
    ws.auto_filter.ref = f"A2:{get_column_letter(ncols)}2"

    if not prev_rows:
        ws.merge_cells(start_row=4, start_column=1, end_row=4, end_column=ncols)
        _write_cell(ws, 4, 1, "Nessun evento futuro trovato nel dataset.",
                    fill=PatternFill("solid", fgColor="F2F2F2"),
                    font=Font(italic=True, color="888888"), align=ALIGN_C)
        return

    # ── Palette colori livello ────────────────────────────────────────────────
    _LVL_STYLE = {
        "🎯 Molto buono":  (PatternFill("solid", fgColor="FFF2CC"),
                             Font(bold=True, color="7D5A00", size=10)),
        "📈 Buono":        (PatternFill("solid", fgColor="C6EFCE"),
                             Font(bold=True, color="375623", size=10)),
        "📊 Basso":        (PatternFill("solid", fgColor="DDEBF7"),
                             Font(color="1F4E79",  size=10)),
        "⏳ Molto basso":  (PatternFill("solid", fgColor="F2F2F2"),
                             Font(color="595959",  size=9, italic=True)),
        "⬜ Troppo presto":(PatternFill("solid", fgColor="EDEDED"),
                             Font(color="888888",  size=9, italic=True)),
    }

    _PRED_STYLE = {
        "↑↑": (PatternFill("solid", fgColor="375623"), Font(bold=True, color="FFFFFF", size=9)),
        "↑":  (PatternFill("solid", fgColor="C6EFCE"), Font(bold=True, color="375623", size=10)),
        "→":  (PatternFill("solid", fgColor="F2F2F2"), Font(color="595959",             size=10)),
        "↓":  (PatternFill("solid", fgColor="FFC7CE"), Font(bold=True, color="9C0006", size=10)),
        "↓↓": (PatternFill("solid", fgColor="9C0006"), Font(bold=True, color="FFFFFF", size=9)),
    }

    def _pred_fill_font(pred: str):
        for k, v in _PRED_STYLE.items():
            if pred.startswith(k): return v
        return None, None

    # ── Dati ─────────────────────────────────────────────────────────────────
    for ri, r in enumerate(prev_rows, start=4):
        bg = ODD_FILL if ri % 2 == 0 else EVEN_FILL

        def _c(col, val, fmt=None, fill=None, font=None, align=None):
            cell = ws.cell(row=ri, column=col, value=val)
            cell.fill      = fill  or bg
            cell.font      = font  or DATA_FONT
            cell.alignment = align or ALIGN_C
            if fmt: cell.number_format = fmt

        _c(1, r["ticker"],   font=Font(bold=True, size=10))
        _c(2, r["name"],     align=ALIGN_L)
        _c(3, r["phase"])
        _c(4, r["comp_date"], fmt="DD/MM/YYYY")
        # Giorni a T con colore urgenza
        _days = r["days_to_t"]
        _days_fill = (PatternFill("solid", fgColor="FFF2CC") if _days <= 3 else
                      PatternFill("solid", fgColor="C6EFCE") if _days <= 7 else bg)
        _c(5, _days, fill=_days_fill,
           font=Font(bold=(_days <= 7), size=10))

        # Livello segnale
        _lv = r["livello"]
        _lv_fill, _lv_font = _LVL_STYLE.get(_lv, (bg, DATA_FONT))
        _c(6, _lv, fill=_lv_fill, font=_lv_font)

        # Affidabilità %
        _aff = r["affidabilita"]
        _aff_fill = (PatternFill("solid", fgColor="C6EFCE") if _aff >= 80 else
                     PatternFill("solid", fgColor="FFEB9C") if _aff >= 60 else
                     PatternFill("solid", fgColor="FFC7CE") if _aff < 45  else bg)
        _aff_cell = ws.cell(row=ri, column=7, value=_aff / 100.0)
        _aff_cell.number_format = "0%"
        _aff_cell.fill      = _aff_fill
        _aff_cell.font      = Font(bold=(_aff >= 75), size=10)
        _aff_cell.alignment = ALIGN_C

        # Predizione (corretta)
        _pf, _pfont = _pred_fill_font(r["predizione"])
        _c(8, r["predizione"], fill=_pf or bg, font=_pfont or DATA_FONT)
        # Predizione raw
        _prf, _prfont = _pred_fill_font(r["pred_raw"])
        _c(9, r["pred_raw"], fill=_prf or bg, font=_prfont or DATA_FONT)

        # RSI
        _rsi = r["rsi"]
        if _rsi is None:
            _c(10, "N/D", fill=PatternFill("solid", fgColor="F2F2F2"),
               font=Font(color="888888", size=9, italic=True))
        else:
            _rf = (PatternFill("solid", fgColor="FFC7CE") if _rsi > 70 else
                   PatternFill("solid", fgColor="C6EFCE") if _rsi < 30 else
                   PatternFill("solid", fgColor="FFEB9C") if _rsi >= 60 else bg)
            _rl = f"{_rsi:.0f} ⚠OB" if _rsi > 70 else f"{_rsi:.0f} ⚠OS" if _rsi < 30 else f"{_rsi:.0f}"
            _c(10, _rl, fill=_rf, font=Font(bold=(_rsi > 70 or _rsi < 30), size=10))

        # Slope Adj. XBI
        _exc = r["exc_slope"]
        if _exc is None:
            _c(11, "N/D", fill=PatternFill("solid", fgColor="FCE4D6"),
               font=Font(color="843C0C", size=9, italic=True))
        else:
            _ef = (PatternFill("solid", fgColor="C6EFCE") if _exc >= 0
                   else PatternFill("solid", fgColor="FFC7CE"))
            _ec = ws.cell(row=ri, column=11, value=_exc / 100.0)
            _ec.number_format = "+0.000%;-0.000%;0.000%"
            _ec.fill = _ef; _ec.alignment = ALIGN_C
            _ec.font = Font(bold=True,
                            color="375623" if _exc >= 0 else "9C0006", size=10)

        # Vol. Build-up
        _vr = r["vol_ratio"]
        if _vr is None:
            _c(12, "N/D", fill=PatternFill("solid", fgColor="F2F2F2"),
               font=Font(color="888888", size=9, italic=True))
        else:
            _vf = (PatternFill("solid", fgColor="C6EFCE") if _vr >= 1.5 else
                   PatternFill("solid", fgColor="FFC7CE") if _vr <= 0.7 else
                   PatternFill("solid", fgColor="FFEB9C"))
            _vt = (f"{_vr:.2f}× ▲" if _vr >= 1.5 else
                   f"{_vr:.2f}× ▼" if _vr <= 0.7 else f"{_vr:.2f}×")
            _c(12, _vt, fill=_vf)

        # Motivo correzione
        _c(13, r["adj_notes"] or "—", align=ALIGN_L,
           font=Font(italic=bool(r["adj_notes"]), size=9,
                     color="843C0C" if r["adj_notes"] else "595959"))

        ws.row_dimensions[ri].height = 20

    # ── Riga totale in fondo ──────────────────────────────────────────────────
    _sr = len(prev_rows) + 4 + 1
    _sf = PatternFill("solid", fgColor="843C0C")
    _sk = Font(bold=True, color="FFFFFF", size=9)
    ws.merge_cells(start_row=_sr, start_column=1, end_row=_sr, end_column=7)
    _write_cell(ws, _sr, 1,
                f"Totale: {n_futuri} eventi  |  ↑ Positivi: {n_pos}  →  Stabili: {n_stable}  ↓ Negativi: {n_neg}",
                fill=_sf, font=_sk, align=ALIGN_C)
    ws.row_dimensions[_sr].height = 18

    # ── Sezione Post-Modello: dati di calibrazione ────────────────────────────
    # Legge pred_calibration.json (scritto da data_orchestrator.py)
    # e lo aggiunge al foglio con stile distinto.
    import json as _json
    import pathlib as _pathlib

    _cp = _pathlib.Path(calib_path or "data/pred_calibration.json")
    _calib_recs: list = []
    if _cp.exists():
        try:
            _calib_recs = _json.loads(_cp.read_text(encoding="utf-8"))
        except Exception:
            _calib_recs = []

    # Ordina: prima i completati (per data T desc), poi i pending (per data T asc)
    _done_recs    = sorted(
        [r for r in _calib_recs if r.get("status") == "complete"],
        key=lambda r: str(r.get("completion_date", "")), reverse=True,
    )
    _pending_recs = sorted(
        [r for r in _calib_recs if r.get("status") == "pending"],
        key=lambda r: str(r.get("completion_date", "")),
    )
    _pm_recs = _done_recs + _pending_recs

    # Riga di separazione vuota
    _pm_start = _sr + 2

    # ── Banner sezione ────────────────────────────────────────────────────────
    _BAN_FILL = PatternFill("solid", fgColor="1F3864")
    _BAN_FONT = Font(bold=True, color="FFFFFF", size=11)
    ws.merge_cells(start_row=_pm_start, start_column=1,
                   end_row=_pm_start, end_column=ncols)
    _write_cell(ws, _pm_start, 1,
                "📊  Dati Post-Modello — Driver Evoluzione del Segnale  "
                "·  Ogni record arricchisce la calibrazione automatica delle predizioni future",
                fill=_BAN_FILL, font=_BAN_FONT, align=ALIGN_C)
    ws.row_dimensions[_pm_start].height = 22

    # ── Descrizione ───────────────────────────────────────────────────────────
    _DESC_ROW = _pm_start + 1
    ws.merge_cells(start_row=_DESC_ROW, start_column=1,
                   end_row=_DESC_ROW, end_column=ncols)
    _desc_txt = (
        "I record 'Completato' mostrano predizione vs prezzo reale a T+3/T+10/T+30 gg. "
        "Con ≥5 record completati il modello applica bias-correction automatica. "
        "I record '⏳ In attesa' diventeranno Completati 35 giorni dopo T."
    )
    _write_cell(ws, _DESC_ROW, 1, _desc_txt,
                fill=PatternFill("solid", fgColor="D6E4F7"),
                font=Font(italic=True, color="1F3864", size=9), align=ALIGN_C)
    ws.row_dimensions[_DESC_ROW].height = 30

    # ── Sub-intestazioni ─────────────────────────────────────────────────────
    _SUB_HDR = _pm_start + 2
    _SUB_COLS = [
        ("Ticker",      "1F3864"), ("Data T",      "1F3864"),
        ("Data Pred.",  "1F3864"), ("Gg a T",      "1F3864"),
        ("★ Qualità",   "4B1C82"),
        ("Pred +3gg",   "375623"), ("Actual +3gg", "375623"), ("Err +3gg",  "375623"),
        ("Pred +10gg",  "843C0C"), ("Actual +10gg","843C0C"), ("Err +10gg", "843C0C"),
        ("Pred +30gg",  "7030A0"), ("Stato",       "1F3864"),
    ]
    for _ci, (_lbl, _clr) in enumerate(_SUB_COLS[:ncols], start=1):
        _write_cell(ws, _SUB_HDR, _ci, _lbl,
                    fill=PatternFill("solid", fgColor=_clr),
                    font=Font(bold=True, color="FFFFFF", size=9), align=ALIGN_C)
    ws.row_dimensions[_SUB_HDR].height = 22

    # ── Dati ─────────────────────────────────────────────────────────────────
    def _pct_cell(rw, col, val, is_err=False):
        """Scrive una cella % con colore condizionale."""
        c2 = ws.cell(row=rw, column=col)
        c2.alignment = ALIGN_C
        if val is None:
            c2.value = "—"
            c2.font  = Font(color="AAAAAA", size=9)
            return
        v = float(val)
        if is_err:   # errore: verde=piccolo, rosso=grande
            _pos  = abs(v) <= 3
            _clr2 = "375623" if _pos else ("7D5A00" if abs(v) <= 8 else "9C0006")
            _fill = (PatternFill("solid", fgColor="C6EFCE") if _pos else
                     PatternFill("solid", fgColor="FFEB9C") if abs(v) <= 8 else
                     PatternFill("solid", fgColor="FFC7CE"))
        else:        # pred/actual: verde=positivo, rosso=negativo
            _clr2 = "375623" if v > 0.5 else ("9C0006" if v < -0.5 else "595959")
            _fill = (PatternFill("solid", fgColor="C6EFCE") if v > 0.5 else
                     PatternFill("solid", fgColor="FFC7CE") if v < -0.5 else
                     PatternFill("solid", fgColor="F2F2F2"))
        c2.value         = v / 100.0
        c2.number_format = '+0.0%;-0.0%;"—"'
        c2.fill  = _fill
        c2.font  = Font(bold=abs(v) >= 5, color=_clr2, size=10)

    _ROW_ODD  = PatternFill("solid", fgColor="EFF3FB")
    _ROW_EVEN = PatternFill("solid", fgColor="DDEAF7")

    _n_done    = len(_done_recs)
    _n_pending = len(_pending_recs)

    for _ri, _rec in enumerate(_pm_recs, start=_SUB_HDR + 1):
        _bg = _ROW_ODD if _ri % 2 == 0 else _ROW_EVEN
        _is_done = _rec.get("status") == "complete"

        def _tc(col, val, fmt=None, fill=None, font=None):
            _cell = ws.cell(row=_ri, column=col, value=val)
            _cell.fill      = fill  or _bg
            _cell.font      = font  or Font(size=10)
            _cell.alignment = ALIGN_C
            if fmt: _cell.number_format = fmt

        # 1 Ticker
        _tc(1, _rec.get("ticker", "—"),
            font=Font(bold=True, color="1F3864", size=10))
        # 2 Data T
        try:
            from datetime import date as _date2
            _cd_val = _date2.fromisoformat(str(_rec["completion_date"]))
        except Exception:
            _cd_val = _rec.get("completion_date")
        _tc(2, _cd_val, fmt="DD/MM/YYYY")
        # 3 Data Pred.
        try:
            _pd_val = _date2.fromisoformat(str(_rec["prediction_date"]))
        except Exception:
            _pd_val = _rec.get("prediction_date")
        _tc(3, _pd_val, fmt="DD/MM/YYYY",
            font=Font(italic=True, color="595959", size=9))
        # 4 Gg a T
        _tc(4, _rec.get("days_to_t"))
        # 5 Qualità ★
        _st = _rec.get("stars", "—")
        _nst = _st.count("★") if _st != "—" else 0
        _star_fills = {5:("FFF2CC","7D5A00"), 4:("C6EFCE","375623"),
                       3:("DDEBF7","1F4E79"), 2:("F2F2F2","595959"),
                       1:("FFC7CE","9C0006")}
        _sfg, _sfc = _star_fills.get(_nst, ("F5F5F5","AAAAAA"))
        _tc(5, _st, fill=PatternFill("solid", fgColor=_sfg),
            font=Font(bold=(_nst >= 4), color=_sfc, size=11))
        # 6-8 Pred/Actual/Err +3gg
        _pct_cell(_ri, 6, _rec.get("d3_pred"))
        _pct_cell(_ri, 7, _rec.get("d3_actual") if _is_done else None)
        _pct_cell(_ri, 8, _rec.get("d3_err")    if _is_done else None, is_err=True)
        # 9-11 Pred/Actual/Err +10gg
        _pct_cell(_ri, 9,  _rec.get("d10_pred"))
        _pct_cell(_ri, 10, _rec.get("d10_actual") if _is_done else None)
        _pct_cell(_ri, 11, _rec.get("d10_err")    if _is_done else None, is_err=True)
        # 12 Pred +30gg
        _pct_cell(_ri, 12, _rec.get("d30_pred"))
        # 13 Stato
        if _is_done:
            _stato = "✅ Completato"
            _sfill = PatternFill("solid", fgColor="C6EFCE")
            _sfont = Font(bold=True, color="375623", size=9)
        else:
            _stato = "⏳ In attesa"
            _sfill = PatternFill("solid", fgColor="FFF2CC")
            _sfont = Font(color="7D5A00", size=9, italic=True)
        _tc(13, _stato, fill=_sfill, font=_sfont)
        ws.row_dimensions[_ri].height = 18

    # ── Riga statistiche finali ───────────────────────────────────────────────
    _stat_row = _SUB_HDR + 1 + len(_pm_recs)
    ws.merge_cells(start_row=_stat_row, start_column=1,
                   end_row=_stat_row, end_column=ncols)

    # Calcola accuratezza direzionale dai completati
    _dir_correct = 0
    _dir_total   = 0
    for _rec in _done_recs:
        _d3a = _rec.get("d3_actual")
        _d3p = _rec.get("d3_pred")
        if _d3a is not None and _d3p is not None:
            _dir_total += 1
            if (_d3p >= 0) == (_d3a >= 0):
                _dir_correct += 1

    if _n_done == 0:
        _stat_txt = (
            f"📊 Post-Modello: {_n_pending} predizioni in attesa  ·  "
            f"Nessun record completato — calibrazione non ancora attiva"
        )
    else:
        _acc_dir = f"{_dir_correct}/{_dir_total} ({_dir_correct/_dir_total*100:.0f}%)" if _dir_total else "—"
        _stat_txt = (
            f"📊 Post-Modello: {_n_done} completati  ·  {_n_pending} in attesa  "
            f"·  Accuratezza direzione +3gg: {_acc_dir}  "
            f"·  Calibrazione bias: {'✅ Attiva' if _n_done >= 5 else f'⏳ {_n_done}/5 obs'}"
        )

    _write_cell(ws, _stat_row, 1, _stat_txt,
                fill=PatternFill("solid", fgColor="1F3864"),
                font=Font(bold=True, color="FFFFFF", size=9), align=ALIGN_C)
    ws.row_dimensions[_stat_row].height = 18


# ─────────────────────────────────────────────────────────────────────────────
# Iniezione pulsante "🔄 Aggiorna" nel file di output (richiede pywin32)
# ─────────────────────────────────────────────────────────────────────────────

def _inject_refresh_button(xlsx_path: str) -> None:
    """
    Converte l'output .xlsx in .xlsm aggiungendo un foglio '🔄 Aggiorna'
    con un pulsante che rilancia data_orchestrator.py.
    Richiede pywin32 (pip install pywin32) + Excel installato su Windows.
    Se pywin32 non è disponibile, salta silenziosamente.
    """
    try:
        import win32com.client as _w32
    except ImportError:
        print("  [Launcher] pywin32 non trovato — foglio Aggiorna non aggiunto.")
        return

    xlsm_path = os.path.splitext(xlsx_path)[0] + ".xlsm"
    abs_xlsx   = os.path.abspath(xlsx_path)
    abs_xlsm   = os.path.abspath(xlsm_path)

    # Codice VBA da iniettare
    VBA = (
        "Option Explicit\r\n"
        "\r\n"
        "Sub AggiornaCompleto()\r\n"
        "    Dim sDir     As String\r\n"
        "    Dim sScript  As String\r\n"
        "    Dim sLog     As String\r\n"
        "    Dim sCmd     As String\r\n"
        "    Dim oWsh     As Object\r\n"
        "    Dim ret      As Long\r\n"
        "    Dim sXlsm    As String\r\n"
        "\r\n"
        "    ' Cartella degli script = cartella padre del file Excel\r\n"
        "    sDir = ThisWorkbook.Path\r\n"
        "    If Right(sDir, 1) = Chr(92) Then sDir = Left(sDir, Len(sDir) - 1)\r\n"
        "    Dim iSep As Long\r\n"
        "    iSep = InStrRev(sDir, Chr(92))\r\n"
        "    If iSep > 0 Then sDir = Left(sDir, iSep - 1)\r\n"
        "\r\n"
        "    sScript = sDir & Chr(92) & \"data_orchestrator.py\"\r\n"
        "    sLog    = sDir & Chr(92) & \"log_orchestrator.txt\"\r\n"
        "    sXlsm   = ThisWorkbook.FullName\r\n"
        "\r\n"
        "    If MsgBox(\"Aggiorna tutti i dati BioTracker?\" & Chr(10) & \"(dura circa 2-5 minuti — non chiudere Excel)\", vbQuestion + vbYesNo, \"BioTracker\") <> vbYes Then Exit Sub\r\n"
        "\r\n"
        "    Application.StatusBar = \"BioTracker: aggiornamento in corso...\"\r\n"
        "    sCmd = \"cmd /c cd /d \" & Chr(34) & sDir & Chr(34) & \" && python \" & Chr(34) & sScript & Chr(34) & \" > \" & Chr(34) & sLog & Chr(34) & \" 2>&1\"\r\n"
        "    Set oWsh = CreateObject(\"WScript.Shell\")\r\n"
        "    ret = oWsh.Run(sCmd, 0, True)\r\n"
        "    Set oWsh = Nothing\r\n"
        "    Application.StatusBar = False\r\n"
        "\r\n"
        "    If ret = 0 Then\r\n"
        "        MsgBox \"Aggiornamento completato!\" & Chr(10) & \"Il file si ricarica con i nuovi dati.\", vbInformation, \"BioTracker\"\r\n"
        "        Dim sNew As String\r\n"
        "        sNew = sXlsm\r\n"
        "        If Dir(sNew) <> \"\" Then\r\n"
        "            Application.DisplayAlerts = False\r\n"
        "            Workbooks.Open sNew\r\n"
        "            Application.DisplayAlerts = True\r\n"
        "        End If\r\n"
        "    Else\r\n"
        "        If MsgBox(\"Errore durante l'aggiornamento (codice: \" & ret & \").\" & Chr(10) & \"Aprire il file di log per dettagli?\", vbCritical + vbYesNo, \"BioTracker - Errore\") = vbYes Then\r\n"
        "            Shell \"notepad.exe \" & Chr(34) & sLog & Chr(34), 1\r\n"
        "        End If\r\n"
        "    End If\r\n"
        "End Sub\r\n"
    )

    def _rgb(r, g, b): return r + g * 256 + b * 65536

    C_DARK   = _rgb(31,  56, 100)
    C_GREEN  = _rgb(0,  112,  44)
    C_WHITE  = _rgb(255, 255, 255)
    C_GREY   = _rgb(242, 242, 242)
    C_YELLOW = _rgb(255, 235, 156)
    C_BLUE   = _rgb(46,   77, 123)

    xl = None
    try:
        xl = _w32.Dispatch("Excel.Application")
        xl.Visible       = False
        xl.DisplayAlerts = False

        wb = xl.Workbooks.Open(abs_xlsx)

        # ── Rimuovi foglio Aggiorna precedente se esiste ──────────────────────
        for sh in list(wb.Worksheets):
            if "Aggiorna" in sh.Name or sh.Name == "🔄":
                sh.Delete()
                break

        # ── Crea foglio in prima posizione ────────────────────────────────────
        ws = wb.Worksheets.Add(Before=wb.Worksheets(1))
        ws.Name = "🔄 Aggiorna"
        ws.Tab.Color = C_GREEN

        # Sfondo generale
        ws.Range("A1:F50").Interior.Color = C_GREY

        # Larghezze colonne
        ws.Columns("A").ColumnWidth = 3
        ws.Columns("B").ColumnWidth = 42
        ws.Columns("C").ColumnWidth = 28
        ws.Columns("D").ColumnWidth = 16
        ws.Columns("E").ColumnWidth = 3

        # Riga titolo
        ws.Rows("1:1").RowHeight = 8
        ws.Rows("2:2").RowHeight = 52
        r_title = ws.Range("A2:E2")
        r_title.Merge()
        r_title.Interior.Color      = C_DARK
        r_title.Font.Color          = C_WHITE
        r_title.Font.Bold           = True
        r_title.Font.Size           = 18
        r_title.Font.Name           = "Calibri"
        r_title.HorizontalAlignment = -4108
        r_title.VerticalAlignment   = -4108
        r_title.Value = "🧬  BioTracker — Aggiornamento Dati"

        ws.Rows("3:3").RowHeight = 12

        # Descrizione
        ws.Rows("4:5").RowHeight = 20
        r_desc = ws.Range("B4:D5")
        r_desc.Merge()
        r_desc.Interior.Color      = C_BLUE
        r_desc.Font.Color          = C_WHITE
        r_desc.Font.Size           = 10
        r_desc.Font.Name           = "Calibri"
        r_desc.HorizontalAlignment = -4108
        r_desc.VerticalAlignment   = -4108
        r_desc.WrapText            = True
        r_desc.IndentLevel         = 1
        r_desc.Value = (
            "Clicca il pulsante per scaricare dati aggiornati, ricalcolare "
            "le previsioni e rigenerare tutti i fogli."
        )

        ws.Rows("6:6").RowHeight = 14
        ws.Rows("7:7").RowHeight = 62
        ws.Rows("8:8").RowHeight = 14

        # Nota
        ws.Rows("9:10").RowHeight = 18
        r_nota = ws.Range("B9:D10")
        r_nota.Merge()
        r_nota.Interior.Color     = C_YELLOW
        r_nota.Font.Size          = 9
        r_nota.Font.Name          = "Calibri"
        r_nota.Font.Color         = _rgb(100, 60, 0)
        r_nota.WrapText           = True
        r_nota.VerticalAlignment  = -4108
        r_nota.IndentLevel        = 1
        r_nota.Value = (
            "⚠️  Durante l'aggiornamento Excel rimane aperto — non chiuderlo. "
            "Al termine il file si ricarica automaticamente con i nuovi dati. "
            "Se viene chiesto 'Abilita macro' → clicca Abilita."
        )

        # ── Modulo VBA ────────────────────────────────────────────────────────
        vba_mod = wb.VBProject.VBComponents.Add(1)
        vba_mod.Name = "BioTrackerRefresh"
        vba_mod.CodeModule.AddFromString(VBA)

        # ── Pulsante ──────────────────────────────────────────────────────────
        btn_cell = ws.Range("B7")
        top    = btn_cell.Top    + 6
        left   = btn_cell.Left   + 6
        width  = btn_cell.Width  - 12
        height = btn_cell.Height - 12

        btn = ws.Buttons().Add(left, top, width, height)
        btn.Caption             = "🔄  Aggiorna Dati BioTracker"
        btn.OnAction            = "AggiornaCompleto"
        btn.Font.Size           = 14
        btn.Font.Bold           = True
        btn.Font.Name           = "Calibri"
        btn.Font.Color          = C_WHITE
        btn.Interior.Color      = C_GREEN
        btn.HorizontalAlignment = -4108

        # ── Salva come .xlsm ──────────────────────────────────────────────────
        wb.SaveAs(abs_xlsm, FileFormat=52)
        wb.Close(False)
        xl.Quit()
        xl = None

        # Rimuovi il vecchio .xlsx se ora esiste il .xlsm
        if os.path.exists(abs_xlsm) and os.path.exists(abs_xlsx):
            try:
                os.remove(abs_xlsx)
            except Exception:
                pass

        print(f"  [Launcher] Output con pulsante: {abs_xlsm}")

    except Exception as _e:
        print(f"  [Launcher] Impossibile iniettare il pulsante: {_e}")
        print("  [Launcher] Suggerimento: abilita 'Accesso VBA' in Excel → Opzioni → Centro protezione.")
        if xl is not None:
            try:
                xl.DisplayAlerts = False
                xl.Quit()
            except Exception:
                pass


if __name__ == "__main__":
    main()
