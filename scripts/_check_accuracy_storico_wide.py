#!/usr/bin/env python3
"""Check wide: storico sessioni vs calendario (Accuracy + past_pred storico)."""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from data_orchestrator import (  # noqa: E402
    SIMULATION_PRED_CAL_OFFSETS,
    _accuracy_sim_histlib_backfill_session_closes,
    _grafici_calendar_pct_vs_m60_at_offsets,
    _hist_close_at_session_offset,
    _histlib_accuracy_sim_resolve_close_series,
    _is_exact_or_partial_sponsor_match,
    _normalize_completion_date_ca,
    _pred_curve_close_cal,
    _sim_harvest_rows_from_workbook,
    _sn7_traj_pct_at_table_offsets,
)
from orchestrator_io_paths import FINAL_XLSX, PAST_CATALYST_PREDICTIONS_JSON  # noqa: E402
from past_pred_io import load_past_pred_map, normalize_past_pred_record  # noqa: E402

THRESH_GAP = 25.0
THRESH_BASE = 0.30
THRESH_ABS = 150.0
OFFSETS = SIMULATION_PRED_CAL_OFFSETS
_SESSION_CLOSE_SPECS = (
    (-60, "close_m60"),
    (-30, "close_m30"),
    (-10, "close_m10"),
    (-7, "close_m7"),
    (-5, "close_m5"),
    (-3, "close_m3"),
    (4, "close_p4"),
    (7, "close_p7"),
)


def _pw_with_session_closes(rec: dict, cd: date, ticker: str, ser_cache: dict) -> dict:
    """Valorizza ``close_m*`` da HistLib (sessioni) senza backfill su tutto il JSON."""
    pw = dict(rec)
    pw.setdefault("ticker", ticker)
    pw.setdefault("completion_date", cd)
    ser = _histlib_accuracy_sim_resolve_close_series(ticker, ser_cache)
    if ser is None:
        return pw
    import pandas as pd

    cd_ts = pd.Timestamp(cd)
    for off, key in _SESSION_CLOSE_SPECS:
        if pw.get(key) is not None:
            try:
                if float(pw[key]) > 0:
                    continue
            except (TypeError, ValueError):
                pass
        val = _hist_close_at_session_offset(ser, cd_ts, int(off))
        if val is not None and val > 0:
            pw[key] = val
    return pw


_cal_traj_cache: dict[tuple[str, str], list] = {}
_sess_traj_cache: dict[tuple[str, str], list] = {}


def _calendar_stor_cached(ticker: str, cd: date, ser_cache: dict) -> list:
    key = (ticker, cd.isoformat())
    if key not in _cal_traj_cache:
        _cal_traj_cache[key] = _grafici_calendar_pct_vs_m60_at_offsets(
            cd, ticker, OFFSETS, ser_cache=ser_cache
        )
    return _cal_traj_cache[key]


def _session_stor_cached(ticker: str, cd: date, pw: dict) -> list:
    key = (ticker, cd.isoformat())
    if key not in _sess_traj_cache:
        _sess_traj_cache[key] = _sn7_traj_pct_at_table_offsets(pw, OFFSETS)
    return _sess_traj_cache[key]


def _analyze_row(ticker: str, cd: date, pw: dict, ser_cache: dict) -> dict:
    stor_sess = _session_stor_cached(ticker, cd, pw)
    stor_cal = _calendar_stor_cached(ticker, cd, ser_cache)
    p60_sess = pw.get("close_m60") or pw.get("close_m60_cal")
    ser = _histlib_accuracy_sim_resolve_close_series(ticker, ser_cache)
    p60_cal = _pred_curve_close_cal(ser, cd, -60) if ser is not None else None
    base_ratio = None
    if p60_sess and p60_cal:
        try:
            fs, fc = float(p60_sess), float(p60_cal)
            if fs > 0 and fc > 0:
                base_ratio = abs(fs / fc - 1.0)
        except (TypeError, ValueError):
            pass
    max_gap = 0.0
    worst_off = None
    for i, off in enumerate(OFFSETS):
        a = stor_sess[i] if i < len(stor_sess) else None
        b = stor_cal[i] if i < len(stor_cal) else None
        if a is not None and b is not None and a == a and b == b:
            g = abs(float(a) - float(b))
            if g > max_gap:
                max_gap, worst_off = g, off
    max_sess = max(
        (abs(float(x)) for x in stor_sess if x is not None and x == x),
        default=0.0,
    )
    flagged = (
        (base_ratio is not None and base_ratio > THRESH_BASE)
        or max_gap > THRESH_GAP
        or max_sess > THRESH_ABS
    )
    return {
        "ticker": ticker,
        "cd": cd.isoformat(),
        "p60_sess": p60_sess,
        "p60_cal": round(float(p60_cal), 4) if p60_cal else None,
        "base_ratio": base_ratio,
        "max_gap": max_gap,
        "worst_off": worst_off,
        "max_sess_abs": max_sess,
        "flagged": flagged,
        "stor_sess_m30": stor_sess[1] if len(stor_sess) > 1 else None,
        "stor_cal_m30": stor_cal[1] if len(stor_cal) > 1 else None,
    }


def _cohort_from_workbook() -> dict[str, dict]:
    import openpyxl

    p = Path(FINAL_XLSX)
    if not p.is_file():
        return {}
    wb = openpyxl.load_workbook(p, data_only=False)
    try:
        harv = {}
        for h in _sim_harvest_rows_from_workbook(wb):
            if not _is_exact_or_partial_sponsor_match(h.get("sponsor_match")):
                continue
            cd = _normalize_completion_date_ca(h.get("completion_date"))
            tk = str(h.get("ticker") or "").strip().upper()
            if not tk or cd is None:
                continue
            pk = f"{tk}|{cd.isoformat()}"
            harv[pk] = dict(h)
        return harv
    finally:
        wb.close()


def _cohort_from_json_all() -> dict[str, dict]:
    raw = load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON)
    out: dict[str, dict] = {}
    for k, rec in raw.items():
        if "|" not in str(k):
            continue
        r = normalize_past_pred_record(dict(rec))
        cd = _normalize_completion_date_ca(r.get("completion_date"))
        tk = str(r.get("ticker") or k.split("|")[0]).strip().upper()
        if not tk or cd is None:
            continue
        out[f"{tk}|{cd.isoformat()}"] = r
    return out


def _run_cohort(name: str, rows_in: dict[str, dict]) -> None:
    if not rows_in:
        print(f"\n=== {name}: (vuoto) ===")
        return
    batch = {k: dict(v) for k, v in rows_in.items()}
    _accuracy_sim_histlib_backfill_session_closes(batch)
    ser_cache: dict = {}
    results = []
    for pk, pw in batch.items():
        cd = _normalize_completion_date_ca(pw.get("completion_date"))
        tk = str(pw.get("ticker") or pk.split("|")[0]).strip().upper()
        if not tk or cd is None:
            continue
        results.append(_analyze_row(tk, cd, pw, ser_cache))
    flagged = [r for r in results if r["flagged"]]
    extreme = [r for r in results if r["max_sess_abs"] > THRESH_ABS]
    big_gap = [r for r in results if r["max_gap"] > THRESH_GAP]
    print(f"\n=== {name} ===")
    print(f"Righe analizzate: {len(results)}")
    print(f"Flag (base>{THRESH_BASE*100:.0f}% o gap>{THRESH_GAP:.0f}pp o |stor|>{THRESH_ABS:.0f}%): {len(flagged)}")
    print(f"  |storico sessioni| > {THRESH_ABS}%: {len(extreme)}")
    print(f"  gap sessioni/calendario > {THRESH_GAP}pp: {len(big_gap)}")
    if extreme:
        print("\n  Outlier |storico| estremo:")
        for r in sorted(extreme, key=lambda x: -x["max_sess_abs"])[:25]:
            print(
                f"    {r['ticker']:<6} {r['cd']}  max|stor|={r['max_sess_abs']:.1f}%  "
                f"m60_sess={r['p60_sess']} m60_cal={r['p60_cal']}"
            )
        if len(extreme) > 25:
            print(f"    ... +{len(extreme) - 25} altre")
    if big_gap:
        print("\n  Gap sessioni vs calendario (top 20):")
        for r in sorted(big_gap, key=lambda x: -x["max_gap"])[:20]:
            br = (
                f"{r['base_ratio'] * 100:.0f}%"
                if r["base_ratio"] is not None
                else "—"
            )
            print(
                f"    {r['ticker']:<6} {r['cd']}  gap={r['max_gap']:.0f}pp @{r['worst_off']}  "
                f"dBase={br}  T-30 sess={r['stor_sess_m30']} cal={r['stor_cal_m30']}"
            )
        if len(big_gap) > 20:
            print(f"    ... +{len(big_gap) - 20} altre")
    ok_n = len(results) - len(flagged)
    print(f"\n  OK (nessun flag): {ok_n}")


def _run_json_bulk(name: str, rows_in: dict[str, dict]) -> None:
    """Analisi massiva JSON con riepilogo aggregato (no elenco completo)."""
    if not rows_in:
        print(f"\n=== {name}: (vuoto) ===")
        return
    _cal_traj_cache.clear()
    _sess_traj_cache.clear()
    _pw_cache: dict[str, dict] = {}
    print(f"\n=== {name} ===")
    print(f"Righe: {len(rows_in)} — preload ticker HistLib…", flush=True)
    ser_cache: dict = {}
    tickers = {
        str(v.get("ticker") or k.split("|")[0]).strip().upper()
        for k, v in rows_in.items()
        if "|" in k
    }
    tickers.discard("")
    for j, tk in enumerate(sorted(tickers), 1):
        _histlib_accuracy_sim_resolve_close_series(tk, ser_cache)
        if j % 200 == 0:
            print(f"  serie caricate: {j}/{len(tickers)}", flush=True)
    from collections import defaultdict

    by_ticker: dict[str, list[tuple[str, date, dict]]] = defaultdict(list)
    for pk, rec in rows_in.items():
        cd = _normalize_completion_date_ca(rec.get("completion_date"))
        tk = str(rec.get("ticker") or pk.split("|")[0]).strip().upper()
        if not tk or cd is None:
            continue
        by_ticker[tk].append((pk, cd, rec))

    n_flag = n_ext = n_gap = n_ok = n_skip = 0
    top_ext: list[dict] = []
    top_gap: list[dict] = []
    n_done = 0
    import pandas as pd

    for tk, items in by_ticker.items():
        if ser_cache.get(tk) is None:
            n_skip += len(items)
            continue
        for pk, cd, rec in items:
            if pk not in _pw_cache:
                _pw_cache[pk] = _pw_with_session_closes(rec, cd, tk, ser_cache)
            pw = _pw_cache[pk]
            if not pw.get("close_m60"):
                n_skip += 1
                continue
            r = _analyze_row(tk, cd, pw, ser_cache)
            n_done += 1
            if r["flagged"]:
                n_flag += 1
            else:
                n_ok += 1
            if r["max_sess_abs"] > THRESH_ABS:
                n_ext += 1
                top_ext.append(r)
            if r["max_gap"] > THRESH_GAP:
                n_gap += 1
                top_gap.append(r)
            if n_done % 1000 == 0:
                print(f"  … {n_done}/{len(rows_in)}", flush=True)
    print(f"Analizzate: {n_flag + n_ok} | skip (no serie): {n_skip} | flag: {n_flag} | OK: {n_ok}")
    print(f"  |storico sessioni| > {THRESH_ABS}%: {n_ext}")
    print(f"  gap sessioni/calendario > {THRESH_GAP}pp: {n_gap}")
    if top_ext:
        print("  Top outlier |storico|:")
        for r in sorted(top_ext, key=lambda x: -x["max_sess_abs"])[:15]:
            print(
                f"    {r['ticker']:<6} {r['cd']}  {r['max_sess_abs']:.1f}%  "
                f"m60_sess={r['p60_sess']} m60_cal={r['p60_cal']}"
            )
    if top_gap:
        print("  Top gap sessioni vs calendario:")
        for r in sorted(top_gap, key=lambda x: -x["max_gap"])[:15]:
            br = f"{r['base_ratio']*100:.0f}%" if r["base_ratio"] is not None else "—"
            print(
                f"    {r['ticker']:<6} {r['cd']}  {r['max_gap']:.0f}pp @{r['worst_off']}  dBase={br}"
            )


def main() -> int:
    wb_harv = _cohort_from_workbook()
    today = date.today()
    wb_future = {
        k: v
        for k, v in wb_harv.items()
        if (_normalize_completion_date_ca(v.get("completion_date")) or today) >= today
    }
    wb_past = {k: v for k, v in wb_harv.items() if k not in wb_future}

    _run_cohort("Accuracy workbook — CD future (Simulation attiva)", wb_future)
    _run_cohort("Accuracy workbook — CD passate (storico clinical)", wb_past)

    print("\nCaricamento past_catalyst_predictions.json …", flush=True)
    json_all = _cohort_from_json_all()
    json_past_cd = {
        k: v
        for k, v in json_all.items()
        if (_normalize_completion_date_ca(v.get("completion_date")) or date.max) < today
    }
    json_not_wb = {k: v for k, v in json_past_cd.items() if k not in wb_harv}
    print(f"JSON totale: {len(json_all)} | CD passate: {len(json_past_cd)} | solo JSON storico: {len(json_not_wb)}")

    _run_json_bulk("past_pred JSON — storico (CD < oggi, tutte le righe)", json_past_cd)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
