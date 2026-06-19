#!/usr/bin/env python3
"""
Orchestrazione refresh Simulation → Accuracy → Predizione guida → Grafici.

Usato da ``launch_refresh_sim_accuracy_grafici.py`` e re-esportato da
``data_orchestrator.regenerate_simulation_accuracy_grafici_sheets``.
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from orchestrator_io_paths import FINAL_XLSX, PAST_CATALYST_PREDICTIONS_JSON
from refresh_fast_status import write_refresh_fast_status


def regenerate_simulation_accuracy_grafici_sheets(
    xlsx_path: str | None = None,
    *,
    refresh_simulation: bool = True,
    refresh_accuracy: bool = True,
    live_sim_pred: bool = True,
    refresh_grafici: bool = True,
    refresh_guida: bool = True,
) -> bool:
    """
    Rigenera nel workbook (default ``FINAL_XLSX``) i fogli richiesti, in ordine:

    1. **Simulation** — ``regenerate_simulation_sheet_quick``.
    2. **Accuracy** — ``prediction.refresh_coordinator`` (enrich JSON + foglio).
    3. **Predizione — guida** — coordinator ``guida``.
    4. **Grafici** — ``simulation_grafici_sheet.refresh_grafici_from_simulation``.
    """
    tgt = os.path.abspath(xlsx_path or FINAL_XLSX)
    if not os.path.isfile(tgt):
        print(f"[Refresh Sim/Acc/Grafici] File non trovato: {tgt}", flush=True)
        return False

    _ok = True
    _step = 0
    _n_steps = sum(
        1 for _f in (refresh_simulation, refresh_accuracy, refresh_guida, refresh_grafici) if _f
    )
    if _n_steps < 1:
        print("[Refresh Sim/Acc/Grafici] Nessun foglio richiesto.", flush=True)
        return True

    if refresh_simulation:
        _step += 1
        write_refresh_fast_status(
            state="running",
            ok=None,
            message=f"Simulation ({_step}/{_n_steps})…",
            workbook=tgt,
        )
        print(
            f"[Refresh Sim/Acc/Grafici] {_step}/{_n_steps} Simulation …",
            flush=True,
        )
        try:
            from data_orchestrator import regenerate_simulation_sheet_quick
        except ImportError as _imp:
            raise ImportError(
                "regenerate_simulation_sheet_quick non trovata in data_orchestrator.py "
                "(file probabilmente troncato). Ripristina il file: "
                "scripts\\RESTORE_DATA_ORCHESTRATOR.md — poi "
                "py -3 scripts\\check_orchestrator_health.py"
            ) from _imp

        try:
            if not regenerate_simulation_sheet_quick(tgt):
                _ok = False
        except PermissionError:
            raise
        except Exception as _se:
            print(f"[Refresh Sim/Acc/Grafici] Simulation KO: {_se}", flush=True)
            _ok = False
            if refresh_accuracy or refresh_guida or refresh_grafici:
                print(
                    "[Refresh Sim/Acc/Grafici] Proseguo con coordinator "
                    "(Accuracy può essere vuota senza Simulation).",
                    flush=True,
                )

    from prediction.refresh_coordinator import run_prediction_refresh

    def _run_kind(kind: str, *, live: bool = False) -> bool:
        _report = run_prediction_refresh(
            kind,
            workbook_path=tgt,
            json_path=PAST_CATALYST_PREDICTIONS_JSON,
            live_sim_pred=live,
            save_json=True,
        )
        for _w in _report.warnings or []:
            print(f"[Refresh Sim/Acc/Grafici] {kind}: {_w}", flush=True)
        return bool(_report.excel_written)

    if refresh_accuracy:
        _step += 1
        write_refresh_fast_status(
            state="running",
            ok=None,
            message=f"Accuracy ({_step}/{_n_steps})…",
            workbook=tgt,
        )
        print(
            f"[Refresh Sim/Acc/Grafici] {_step}/{_n_steps} Accuracy "
            f"(live_sim_pred={'sì' if live_sim_pred else 'no'}) …",
            flush=True,
        )
        try:
            if not _run_kind("accuracy", live=live_sim_pred):
                _ok = False
        except PermissionError:
            raise
        except Exception as _ae:
            print(f"[Refresh Sim/Acc/Grafici] Accuracy KO: {_ae}", flush=True)
            _ok = False

    if refresh_guida:
        _step += 1
        print(
            f"[Refresh Sim/Acc/Grafici] {_step}/{_n_steps} Predizione — guida …",
            flush=True,
        )
        try:
            if not _run_kind("guida"):
                _ok = False
        except PermissionError:
            raise
        except Exception as _ge:
            print(f"[Refresh Sim/Acc/Grafici] Guida KO: {_ge}", flush=True)
            _ok = False

    if refresh_grafici:
        _step += 1
        print(
            f"[Refresh Sim/Acc/Grafici] {_step}/{_n_steps} Grafici …",
            flush=True,
        )
        try:
            if not _run_kind("grafici"):
                _ok = False
        except PermissionError:
            raise
        except Exception as _grfe:
            print(f"[Refresh Sim/Acc/Grafici] Grafici KO: {_grfe}", flush=True)
            _ok = False

    print(
        f"[Refresh Sim/Acc/Grafici] Fine — {'OK' if _ok else 'completato con avvisi/errori'} "
        f"→ {tgt}",
        flush=True,
    )
    return _ok


def main(argv: list[str] | None = None) -> int:
    """CLI: stessi flag di ``launch_refresh_sim_accuracy_grafici.py``."""
    import sys

    _args = list(argv if argv is not None else sys.argv[1:])
    _paths = [a for a in _args if not a.startswith("-")]
    _path = _paths[0] if _paths else FINAL_XLSX
    _skip_sim = "--skip-simulation" in _args
    _no_live = "--no-live-sim-pred" in _args
    _skip_graf = "--skip-grafici" in _args
    _skip_guida = "--skip-guida" in _args
    _skip_acc = "--skip-accuracy" in _args

    if _no_live and "--full-json-enrich" not in _args:
        os.environ.setdefault("ACCURACY_REFRESH_FAST", "1")

    print(f"[Refresh] Workbook: {_path}", flush=True)
    if _skip_sim:
        print("[Refresh] --skip-simulation: salta Simulation.", flush=True)
    if _skip_acc:
        print("[Refresh] --skip-accuracy: salta Accuracy.", flush=True)
    if _no_live:
        print(
            "[Refresh] --no-live-sim-pred: enrich leggero (ACCURACY_REFRESH_FAST=1).",
            flush=True,
        )
    if _skip_guida:
        print("[Refresh] --skip-guida: salta Predizione — guida.", flush=True)
    if _skip_graf:
        print("[Refresh] --skip-grafici: Grafici non aggiornati.", flush=True)

    try:
        _ok = regenerate_simulation_accuracy_grafici_sheets(
            _path,
            refresh_simulation=not _skip_sim,
            refresh_accuracy=not _skip_acc,
            live_sim_pred=not _no_live,
            refresh_grafici=not _skip_graf,
            refresh_guida=not _skip_guida,
        )
    except PermissionError:
        print(
            "\n[ERRORE] Impossibile salvare — chiudi il file in Excel e riprova.\n",
            flush=True,
        )
        return 1
    except Exception as exc:
        print(f"\n[ERRORE] {exc}\n", flush=True)
        return 1

    return 0 if _ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
