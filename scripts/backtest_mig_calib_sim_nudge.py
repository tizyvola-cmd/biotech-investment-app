#!/usr/bin/env python3
"""
Backtest MII/Calib + nudge Pred+5 **solo cohort Simulation**.

Cohort (scegli con --cohort):
  sim-tickers   — ticker attualmente sul foglio Simulation (46) × storico past_pred CD passate
  sim-open      — solo ticker in portafoglio aperto (capitale > 0)
  sim-keys      — match esatto ticker|CD righe Simulation (quasi tutte CD future → pochi esiti)
  full          — alias del backtest globale (sponsor exact/partial)

Nudge (solo tier **contrarian**):
  pred_nudged = (1-w)*model + w*market_delta_5d   (market = slope_5d×5 @ T-10)

Confronta MAE fwd5 (T-10→T-5) e post5 (CD+5) per w = 0, 0.5, 0.7, 1.0.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path
from statistics import mean

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import (  # noqa: E402
    INVEST_SIM_INPUTS_JSON,
    PAST_CATALYST_PREDICTIONS_JSON,
    SIMULATION_SHEET_SNAPSHOT_JSON,
)
from past_pred_io import load_past_pred_map  # noqa: E402
from scripts.backtest_mig_calib_pred_error import (  # noqa: E402
    Case,
    _agg,
    _print_group,
    agg_nudged_mae,
    build_cases,
    case_err_fwd5_nudged,
)


def _parse_cd(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if len(s) >= 10 and s[4] == "-":
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            pass
    m = re.match(r"(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
        try:
            return date(y, mo, d)
        except (ValueError, OSError):
            return None
    return None


def _sponsor_match(row: dict) -> str:
    for k, v in row.items():
        kl = k.lower()
        if "exact" in kl and "unmatch" in kl:
            return str(v or "").strip().lower()
    return ""


def load_sim_snapshot() -> list[dict]:
    p = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    if not p.is_file():
        return []
    doc = json.loads(p.read_text(encoding="utf-8"))
    return list(doc.get("rows") or [])


def sim_ticker_universe(sim_rows: list[dict]) -> set[str]:
    out: set[str] = set()
    for r in sim_rows:
        tk = str(r.get("Ticker") or "").strip().upper()
        if tk and "TOTALE" not in tk:
            out.add(tk)
    return out


def sim_row_keys(sim_rows: list[dict], *, exact_partial_only: bool = True) -> set[str]:
    out: set[str] = set()
    for r in sim_rows:
        tk = str(r.get("Ticker") or "").strip().upper()
        cd = _parse_cd(r.get("Completion Date"))
        if not tk or not cd:
            continue
        if exact_partial_only:
            sm = _sponsor_match(r)
            if sm not in ("exact", "partial"):
                continue
        out.add(f"{tk}|{cd.isoformat()}")
    return out


def sim_open_tickers() -> set[str]:
    p = Path(INVEST_SIM_INPUTS_JSON)
    if not p.is_file():
        return set()
    doc = json.loads(p.read_text(encoding="utf-8"))
    inputs = doc.get("inputs") or {}
    out: set[str] = set()
    for key, row in inputs.items():
        if not isinstance(row, dict):
            continue
        cap = float(row.get("capital") or row.get("capital_eur") or 0)
        if cap <= 0:
            continue
        tk = str(key).split("|")[0].strip().upper()
        if tk:
            out.add(tk)
    return out


def filter_cases(cases: list[Case], cohort: str, sim_rows: list[dict]) -> tuple[list[Case], str]:
    if cohort == "full":
        return cases, "past_pred globale (sponsor exact/partial @ T-10)"

    tickers = sim_ticker_universe(sim_rows)
    keys = sim_row_keys(sim_rows)
    open_tk = sim_open_tickers()

    if cohort == "sim-tickers":
        sub = [c for c in cases if c.ticker in tickers]
        label = f"Simulation attiva — {len(tickers)} ticker × storico CD passate"
    elif cohort == "sim-open":
        sub = [c for c in cases if c.ticker in open_tk]
        label = f"Portafoglio aperto — {len(open_tk)} ticker × storico CD passate"
    elif cohort == "sim-keys":
        sub = [c for c in cases if f"{c.ticker}|{c.cd}" in keys]
        label = f"Match esatto righe Simulation ({len(keys)} chiavi snapshot)"
    else:
        raise ValueError(f"cohort sconosciuta: {cohort}")

    return sub, label


def _print_nudge_table(
    cases: list[Case],
    weights: list[float],
    *,
    title: str,
) -> None:
    contra = [c for c in cases if c.calib_tier == "contrarian"]
    print(f"\n=== {title} ===")
    print(f"  Contrarian nel sottoinsieme: {len(contra)} / {len(cases)}")

    if not contra:
        print("  (nessun caso contrarian — nudge non applicabile)")
        return

    base_fwd = _agg(contra, "err_fwd5", "hit_fwd5")
    base_p5 = _agg(contra, "err_post5", "hit_post5")
    print(
        f"  Baseline contrarian (w=0): fwd5 MAE={base_fwd.get('mae', 'n/a')} pp (n={base_fwd.get('n', 0)})"
        f" | post5 MAE={base_p5.get('mae', 'n/a')} pp (n={base_p5.get('n', 0)})"
    )

    print("\n  Nudge solo contrarian (market = slope_5d x 5 @ T-10):")
    print(f"  {'w':>4}  {'fwd5 MAE':>10}  {'delta fwd5':>12}  {'post5 MAE':>10}  {'delta post5':>12}")
    base_fwd_mae = base_fwd.get("mae")
    base_p5_mae = base_p5.get("mae")

    best_fwd = (None, None)
    best_p5 = (None, None)

    for w in weights:
        a_fwd = agg_nudged_mae(cases, w, horizon="fwd5", contrarian_only=True, subset=contra)
        a_p5 = agg_nudged_mae(cases, w, horizon="post5", contrarian_only=True, subset=contra)
        d_fwd = (
            round(a_fwd["mae"] - base_fwd_mae, 2)
            if base_fwd_mae is not None and a_fwd.get("mae") is not None
            else None
        )
        d_p5 = (
            round(a_p5["mae"] - base_p5_mae, 2)
            if base_p5_mae is not None and a_p5.get("mae") is not None
            else None
        )
        if d_fwd is not None and (best_fwd[0] is None or d_fwd < best_fwd[0]):
            best_fwd = (d_fwd, w)
        if d_p5 is not None and (best_p5[0] is None or d_p5 < best_p5[0]):
            best_p5 = (d_p5, w)
        print(
            f"  {w:4.1f}  {a_fwd.get('mae', 'n/a'):>10}  "
            f"{(f'{d_fwd:+.2f} pp' if d_fwd is not None else 'n/a'):>12}  "
            f"{a_p5.get('mae', 'n/a'):>10}  "
            f"{(f'{d_p5:+.2f} pp' if d_p5 is not None else 'n/a'):>12}"
        )

    if best_fwd[0] is not None:
        print(
            f"\n  Miglior w fwd5 (contrarian): w={best_fwd[1]} -> delta MAE {best_fwd[0]:+.2f} pp"
        )
    if best_p5[0] is not None:
        print(
            f"  Miglior w post5 (contrarian): w={best_p5[1]} -> delta MAE {best_p5[0]:+.2f} pp"
        )

    # Effetto collaterale: MAE su non-contrarian deve restare identica
    non = [c for c in cases if c.calib_tier != "contrarian"]
    if non and weights:
        w_test = weights[-1]
        unchanged_fwd = all(
            (e := case_err_fwd5_nudged(c, w_test)) is not None
            and c.err_fwd5 is not None
            and abs(e - c.err_fwd5) < 1e-9
            for c in non
            if c.err_fwd5 is not None
        )
        print(f"\n  Non-contrarian invariati con nudge (w={w_test}): {'OK' if unchanged_fwd else 'CHECK'}")


def _print_cohort_summary(sim_rows: list[dict]) -> None:
    tickers = sim_ticker_universe(sim_rows)
    keys = sim_row_keys(sim_rows)
    open_tk = sim_open_tickers()
    future_keys = sum(
        1
        for k in keys
        if (_parse_cd(k.split("|", 1)[1]) or date.max) >= date.today()
    )
    print("--- Snapshot Simulation ---")
    print(f"  Righe snapshot: {len(sim_rows)} | ticker: {len(tickers)} | chiavi exact/partial: {len(keys)}")
    print(f"  CD future (no esito storico diretto): {future_keys}/{len(keys)}")
    print(f"  Portafoglio aperto (cap>0): {len(open_tk)} ticker -> {', '.join(sorted(open_tk))}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", default=PAST_CATALYST_PREDICTIONS_JSON)
    ap.add_argument(
        "--cohort",
        choices=("sim-tickers", "sim-open", "sim-keys", "full"),
        default="sim-tickers",
    )
    ap.add_argument(
        "--weights",
        default="0,0.5,0.7,1.0",
        help="Pesi nudge verso mercato (solo contrarian)",
    )
    ap.add_argument("--all-sponsors", action="store_true")
    args = ap.parse_args()

    weights = [float(x.strip()) for x in args.weights.split(",") if x.strip()]
    sim_rows = load_sim_snapshot()
    _print_cohort_summary(sim_rows)

    rows = load_past_pred_map(args.json)
    all_cases = build_cases(rows, all_sponsors=args.all_sponsors)
    if args.cohort == "full":
        cases = all_cases
        label = "past_pred globale"
    else:
        cases, label = filter_cases(all_cases, args.cohort, sim_rows)

    print(f"\n=== Cohort: {label} ===")
    print(f"  Casi analizzabili: {len(cases)} (su {len(all_cases)} globali, {len(rows)} JSON)")

    if not cases:
        print("\nNessun caso con esito storico. Le righe Simulation attuali hanno CD future:")
        print("  usare --cohort sim-tickers o sim-open per backtest storico per ticker.")
        return 0

    _print_group(f"BASELINE {args.cohort}", cases)

    tiers = ["aligned", "drift", "diverge", "contrarian"]
    for tier in tiers:
        sub = [c for c in cases if c.calib_tier == tier]
        if sub:
            _print_group(f"Calib tier = {tier}", sub)

    _print_nudge_table(
        cases,
        weights,
        title=f"NUDGE Pred+5 contrarian-only ({args.cohort})",
    )

    # MAE globale se nudge solo contrarian (tutti i casi del cohort)
    w_use = 0.7 if 0.7 in weights else (weights[1] if len(weights) > 1 else weights[0])
    all_fwd_base = mean(c.err_fwd5 for c in cases if c.err_fwd5 is not None)
    all_fwd_nud = mean(e for c in cases if (e := case_err_fwd5_nudged(c, w_use)) is not None)
    print(f"\n=== Impatto cohort intero (nudge w={w_use} solo contrarian) ===")
    print(
        f"  fwd5 MAE: {all_fwd_base:.2f} -> {all_fwd_nud:.2f} pp"
        f" (delta {all_fwd_nud - all_fwd_base:+.2f})"
    )

    print("\n* post20 = model_d30/d30 (proxy lungo)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
