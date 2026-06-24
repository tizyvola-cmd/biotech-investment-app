#!/usr/bin/env python3
"""
Refresh rapido **senza orchestrator completo**.

Aggiorna Simulation (merge JSON + predizioni) e Accuracy mantenendo gli input/esiti
P&L già inseriti sul foglio Simulation (Prezzo acquisto, Capitale).

Uso (Excel chiuso, dalla root progetto):
  py -3 refresh_fast.py
  py -3 refresh_fast.py --dry-run
  py -3 refresh_fast.py --skip-simulation
  py -3 refresh_fast.py --skip-accuracy
  py -3 refresh_fast.py --no-live-pred
  py -3 refresh_fast.py --with-guida --with-grafici
  py -3 refresh_fast.py --update-json-outcomes

Equivalente batch: scripts\\Avvia_Refresh_Fast.bat
"""
from __future__ import annotations

import argparse
import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from orchestrator_io_paths import FINAL_XLSX, PAST_CATALYST_PREDICTIONS_JSON
from refresh_desktop_app import daily_refresh_env_patch, is_daily_refresh_fast
from refresh_fast_status import (
    find_latest_staged_workbook,
    write_refresh_fast_status,
)


def _update_past_json_outcomes(wb_path: str) -> bool:
    """
    Aggiorna ``past_catalyst_predictions.json`` in modo incrementale (solo righe
    mancanti/incomplete) senza riscrivere il workbook.
    """
    from openpyxl import load_workbook

    from data_orchestrator import (
        _collect_all_past_catalyst_rows,
        _past_pred_acquire_incremental,
        _run_simulation_sheet_into_workbook,
        merge_by_symbol,
        add_modality_column,
        add_sponsor_match_column,
        _build_financial_df_for_orchestrator,
    )

    print("[Fast refresh] JSON outcomes: merge + raccolta righe passate …", flush=True)
    master_df, clinical_df = merge_by_symbol()
    financial_df = _build_financial_df_for_orchestrator(master_df)
    if financial_df.empty:
        print("[Fast refresh] Financial vuoto — skip JSON outcomes.", flush=True)
        return False
    if clinical_df.empty:
        clinical_df_rich = clinical_df
    else:
        clinical_df_rich = add_sponsor_match_column(add_modality_column(clinical_df))

    wb = load_workbook(wb_path, read_only=False, keep_vba=False)
    ctx = _run_simulation_sheet_into_workbook(
        wb,
        financial_df=financial_df,
        clinical_df=clinical_df,
        clinical_df_rich=clinical_df_rich,
        portfolio_xlsx_path=wb_path,
        sec_k8_rows_only=True,
    )
    if not ctx:
        print("[Fast refresh] Impossibile costruire coorte passata (lite KO).", flush=True)
        return False
    past_rows = ctx.get("_sim_rows_past") or []
    studies = ctx.get("_ticker_studies_past") or {}
    if not past_rows:
        print("[Fast refresh] Nessuna riga passata da aggiornare nel JSON.", flush=True)
        return True
    cache = _collect_all_past_catalyst_rows(
        past_rows,
        studies,
        clinical_df_rich if not getattr(clinical_df_rich, "empty", True) else clinical_df,
        financial_df,
    )
    if not cache:
        print("[Fast refresh] Raccolta past catalyst vuota.", flush=True)
        return True
    _past_pred_acquire_incremental(cache)
    print(f"[Fast refresh] JSON aggiornato → {PAST_CATALYST_PREDICTIONS_JSON}", flush=True)
    return True


def run_fast_refresh(
    xlsx_path: str,
    *,
    dry_run: bool = False,
    refresh_simulation: bool = True,
    refresh_accuracy: bool = True,
    live_sim_pred: bool = True,
    refresh_guida: bool = False,
    refresh_grafici: bool = False,
    update_json_outcomes: bool = False,
    preserve_outcomes: bool = True,
) -> bool:
    tgt = os.path.abspath(xlsx_path)
    if not os.path.isfile(tgt):
        print(f"[Fast refresh] Workbook non trovato: {tgt}", flush=True)
        write_refresh_fast_status(
            state="error",
            ok=False,
            message=f"Workbook non trovato: {tgt}",
            workbook=tgt,
        )
        return False

    if preserve_outcomes:
        os.environ.setdefault("SIM_PRESERVE_OUTCOMES", "1")
    else:
        os.environ["SIM_PRESERVE_OUTCOMES"] = "0"

    print(f"[Fast refresh] Target: {tgt}", flush=True)
    _fast_daily = is_daily_refresh_fast()
    print(
        "[Fast refresh] Piano: "
        f"sim={'sì' if refresh_simulation else 'no'} | "
        f"acc={'sì' if refresh_accuracy else 'no'} | "
        f"guida={'sì' if refresh_guida else 'no'} | "
        f"grafici={'sì' if refresh_grafici else 'no'} | "
        f"preserve P&L={'sì' if preserve_outcomes else 'no'} | "
        f"live pred={'sì' if live_sim_pred else 'no'} | "
        f"json outcomes={'sì' if update_json_outcomes else 'no'} | "
        f"daily_fast={'sì' if _fast_daily else 'no'}",
        flush=True,
    )
    if _fast_daily:
        print(
            "[Fast refresh] Profilo giornaliero veloce: "
            "skip clinical past extra, Accuracy FAST, no v5 raw su storico.",
            flush=True,
        )

    if dry_run:
        print("[Fast refresh] --dry-run: nessuna scrittura.", flush=True)
        write_refresh_fast_status(
            state="dry_run",
            ok=True,
            message="Dry-run: nessuna scrittura.",
            workbook=tgt,
        )
        return True

    from orchestrator_preflight import orchestrator_preflight

    _pf_ok, _pf_msg = orchestrator_preflight(refresh_simulation=refresh_simulation)
    print(f"[Fast refresh] Preflight: {_pf_msg}", flush=True)
    if not _pf_ok:
        write_refresh_fast_status(
            state="error",
            ok=False,
            message=_pf_msg,
            workbook=tgt,
        )
        return False

    print(
        "[Fast refresh] Caricamento data_orchestrator (file grande: può richiedere 30–90 s) …",
        flush=True,
    )

    write_refresh_fast_status(
        state="running",
        ok=None,
        message="Refresh in corso… (import orchestrator)",
        workbook=tgt,
    )

    _skip_acc_daily = os.environ.get("DAILY_SKIP_ACCURACY_SHEET", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if is_daily_refresh_fast() and _skip_acc_daily:
        refresh_accuracy = False
        print(
            "[Fast refresh] Profilo giornaliero: skip foglio Accuracy "
            "(DAILY_SKIP_ACCURACY_SHEET).",
            flush=True,
        )

    try:
        write_refresh_fast_status(
            state="running",
            ok=None,
            message="Refresh in corso… (Simulation / export)",
            workbook=tgt,
        )
        if update_json_outcomes and not refresh_simulation:
            _ok = _update_past_json_outcomes(tgt)
        else:
            from refresh_sim_accuracy_grafici import (
                regenerate_simulation_accuracy_grafici_sheets,
            )

            _ok = regenerate_simulation_accuracy_grafici_sheets(
                tgt,
                refresh_simulation=refresh_simulation,
                refresh_accuracy=refresh_accuracy,
                live_sim_pred=live_sim_pred,
                refresh_grafici=refresh_grafici,
                refresh_guida=refresh_guida,
            )
            if _ok and update_json_outcomes:
                _update_past_json_outcomes(tgt)

        _staged = find_latest_staged_workbook(tgt)
        _msg = "Refresh completato." if _ok else "Refresh con errori (vedi console)."
        if _staged:
            _msg += f" File staged: {_staged}"
        _snap_ok = False
        if _ok:
            try:
                write_refresh_fast_status(
                    state="running",
                    ok=None,
                    message="Export snapshot UI…",
                    workbook=tgt,
                )
                from excel_sheet_reader import export_desktop_snapshots

                _essential = is_daily_refresh_fast()
                export_desktop_snapshots(
                    xlsx_path=tgt,
                    essential_only=_essential,
                )
                _snap_ok = True
                _msg += (
                    " Snapshot essenziali (Simulation)."
                    if _essential
                    else " Snapshot desktop esportati."
                )
            except Exception as exc:
                print(f"[Fast refresh] export_desktop_snapshots: {exc}", flush=True)
                _msg += f" (export snapshot fallito: {exc})"

        write_refresh_fast_status(
            state="ok" if _ok else "error",
            ok=_ok,
            message=_msg,
            workbook=tgt,
            staged_workbook=_staged,
            snapshots_exported=_snap_ok if _ok else False,
        )
        return _ok
    except PermissionError:
        write_refresh_fast_status(
            state="error",
            ok=False,
            message="Excel tiene aperto il file — chiudere il workbook e riprovare.",
            workbook=tgt,
        )
        raise
    except Exception as exc:
        write_refresh_fast_status(
            state="error",
            ok=False,
            message=str(exc),
            workbook=tgt,
        )
        raise


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("workbook", nargs="?", default=FINAL_XLSX)
    ap.add_argument("--dry-run", action="store_true", help="Mostra piano senza scrivere.")
    ap.add_argument("--skip-simulation", action="store_true")
    ap.add_argument("--skip-accuracy", action="store_true")
    ap.add_argument("--no-live-sim-pred", action="store_true")
    ap.add_argument("--with-guida", action="store_true")
    ap.add_argument("--with-grafici", action="store_true")
    ap.add_argument(
        "--update-json-outcomes",
        action="store_true",
        help="Dopo Excel, aggiorna past_catalyst_predictions.json (incrementale).",
    )
    ap.add_argument(
        "--no-preserve-outcomes",
        action="store_true",
        help="Non ripristinare Prezzo acquisto / Capitale dopo refresh Simulation.",
    )
    ap.add_argument(
        "--full-json-enrich",
        action="store_true",
        help="Con --no-live-sim-pred, enrich JSON completo (disabilita FAST).",
    )
    args = ap.parse_args(argv)

    # Passo 1: mercato reale pre-CD + finestra 8-K 6 mesi (override con env).
    os.environ.setdefault("PRED_CURVE_SEQ_CALIB", "1")
    os.environ.setdefault("SEC_K8_LOOKBACK_DAYS", "180")
    os.environ.setdefault("PRED_K8_DISPLAY_OVERLAY", "1")
    os.environ.setdefault("ACCURACY_SEQ_BLEND_TO_MODEL", "0")
    os.environ.setdefault("REFRESH_K8_LIVE_FALLBACK", "1")
    os.environ.setdefault("HISTLIB_INCREMENTAL_ONLY", "1")
    os.environ.setdefault("HISTLIB_MIN_LAG_DAYS", "3")
    os.environ.setdefault("YF_CACHE_STICKY", "1")
    os.environ.setdefault("ORCH_SKIP_LIQUIDITY_YF", "1")
    # Passo 2: shrink solo post-CD; model_dm* ×1.05; damp dm60 off
    os.environ.setdefault("PRED_V4_CURVE_SCALE_PRECD", "1.05")
    os.environ.setdefault("PRED_CURVE_APPLY_CAL_FACTOR", "1")
    if is_daily_refresh_fast():
        for _k, _v in daily_refresh_env_patch().items():
            os.environ.setdefault(_k, _v)
    elif not args.no_live_sim_pred:
        os.environ.setdefault("ACCURACY_REFRESH_FAST", "0")
        os.environ.setdefault("ACC_SIM_BULK_PAST_WRITE", "0")

    if args.no_live_sim_pred and not args.full_json_enrich:
        os.environ.setdefault("ACCURACY_REFRESH_FAST", "1")

    try:
        ok = run_fast_refresh(
            args.workbook,
            dry_run=args.dry_run,
            refresh_simulation=not args.skip_simulation,
            refresh_accuracy=not args.skip_accuracy,
            live_sim_pred=not args.no_live_sim_pred,
            refresh_guida=args.with_guida,
            refresh_grafici=args.with_grafici,
            update_json_outcomes=args.update_json_outcomes,
            preserve_outcomes=not args.no_preserve_outcomes,
        )
    except PermissionError:
        print(
            "\n[ERRORE] Impossibile salvare — chiudi Excel sul workbook e riprova.\n",
            flush=True,
        )
        return 1
    except Exception as exc:
        print(f"\n[ERRORE] {exc}\n", flush=True)
        return 1

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
