#!/usr/bin/env python3
"""
Evaluate expected improvement from upgraded _indicator_unit_score.

Compares:
  A) OLD logic: endpoint_met + direction + numeric_value only
  B) NEW logic: + p_value, data_maturity, vs_soc, kpi_type, CI

For each enriched record in the clinical snapshot:
  - Computes indicator_shift_pp with old and new logic
  - Cross-references with past predictions to measure accuracy delta
    for records that had clinical KPI data vs those that didn't.

Run:
  python tools/evaluate_kpi_improvement.py
"""
from __future__ import annotations

import io
import json
import math
import sys
from datetime import date
from pathlib import Path
from typing import Any

# Force UTF-8 output on Windows
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON  # noqa: E402
from past_pred_io import load_past_pred_map  # noqa: E402

# ── Old indicator score (pre-improvement) ──────────────────────────────────────

def _indicator_unit_score_old(ind: dict[str, Any]) -> float:
    if not isinstance(ind, dict):
        return 0.0
    s = 0.0
    ep = ind.get("endpoint_met")
    if ep is True:
        s += 1.0
    elif ep is False:
        s -= 1.0
    d = str(ind.get("direction") or "").strip().lower()
    if d == "up":
        s += 0.45
    elif d == "down":
        s -= 0.45
    try:
        nv = ind.get("numeric_value")
        if nv is not None and nv == nv:
            n = float(nv)
            lab = str(ind.get("label") or "").lower()
            if any(k in lab for k in ("orr", "response", "pfs", "os", "survival", "efficacy")):
                if n >= 50:
                    s += 0.25
                elif n <= 10 and "orr" in lab:
                    s -= 0.2
    except (TypeError, ValueError):
        pass
    return s


# ── New indicator score (post-improvement) ─────────────────────────────────────

import re as _re

_KPI_W = {"efficacy": 1.0, "regulatory": 0.9, "biomarker": 0.6,
           "safety": 0.5, "enrollment": 0.2, "other": 0.3}
_DM_BONUS = {"final": 0.30, "primary": 0.15, "interim": 0.00, "not_reported": -0.10}


def _pval(text: str) -> float | None:
    m = _re.search(r"\d+\.\d+", text or "")
    return float(m.group(0)) if m else None


def _indicator_unit_score_new(ind: dict[str, Any]) -> float:
    if not isinstance(ind, dict):
        return 0.0
    s = 0.0
    ep = ind.get("endpoint_met")
    if ep is True:
        s += 1.0
    elif ep is False:
        s -= 1.0
    else:
        d = str(ind.get("direction") or "").strip().lower()
        if d == "up":
            s += 0.35
        elif d == "down":
            s -= 0.35
    p = _pval(str(ind.get("p_value") or ""))
    if p is not None:
        if p < 0.001:   s += 0.60
        elif p < 0.01:  s += 0.40
        elif p < 0.05:  s += 0.20
        else:           s -= 0.20
    dm = str(ind.get("data_maturity") or "not_reported").lower()
    s += _DM_BONUS.get(dm, 0.0)
    vs_soc = str(ind.get("vs_soc") or "")
    if vs_soc and vs_soc.lower() not in ("null", "n/d", ""):
        s += 0.20
    ci = str(ind.get("confidence_interval") or "")
    if ci and ci.lower() not in ("null", "n/d", ""):
        s += 0.10
    try:
        nv = ind.get("numeric_value")
        if nv is not None and nv == nv:
            n = float(nv)
            lab = str(ind.get("label") or "").lower()
            if any(k in lab for k in ("orr", "response", "pfs", "os", "survival", "efficacy")):
                if n >= 50:   s += 0.25
                elif n <= 10 and "orr" in lab: s -= 0.20
    except (TypeError, ValueError):
        pass
    kpi_type = str(ind.get("kpi_type") or "other").lower()
    s *= _KPI_W.get(kpi_type, 0.3)
    return s


# ── Aggregation (mirrors ai_feed_recalib logic) ───────────────────────────────

ALPHA = 0.35
MAX_PP = 4.0
HALF_LIFE = 21.0


def _agg_shift(indicators: list[dict[str, Any]], score_fn, today: date,
               ref_date: date | None = None) -> tuple[float, int]:
    scored: list[tuple[date | None, float]] = []
    for ind in indicators:
        unit = score_fn(ind)
        if abs(unit) < 1e-6:
            continue
        raw_d = ind.get("indicator_date")
        try:
            ed: date | None = date.fromisoformat(str(raw_d)[:10]) if raw_d else None
        except ValueError:
            ed = None
        scored.append((ed, unit))
    if not scored:
        return 0.0, 0
    num = den = 0.0
    for ed, unit in scored:
        age = max(0, (today - ed).days) if ed else 0
        w = math.exp(-age / max(1.0, HALF_LIFE))
        num += unit * w
        den += w
    if den <= 0:
        return 0.0, 0
    mean = num / den
    raw_pp = mean * ALPHA
    return round(max(-MAX_PP, min(MAX_PP, raw_pp)), 3), len(scored)


# ── Main ──────────────────────────────────────────────────────────────────────

def _load_snapshot() -> list[dict[str, Any]]:
    p = _ROOT / "data" / "clinical_pre_cd_enrichment_snapshot.json"
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        return doc.get("records") or []
    except Exception as e:
        print(f"[WARN] Cannot load enrichment snapshot: {e}", file=sys.stderr)
        return []


def _direction_hit(pred_row: dict[str, Any]) -> bool | None:
    d5 = pred_row.get("d5_pct")
    d3 = pred_row.get("d3_pct")
    actual = d5 if d5 is not None else d3
    if actual is None:
        return None
    pred_dir = str(pred_row.get("direction") or pred_row.get("dir_v4") or "").lower()
    if pred_dir in ("up", "bullish"):
        return actual > 5.0
    if pred_dir in ("down", "bearish"):
        return actual < -5.0
    return None


def main() -> None:
    today = date.today()
    records = _load_snapshot()
    past_map = load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON)

    print(f"Enrichment records: {len(records)}")
    print(f"Past pred records:  {len(past_map)}\n")

    results: list[dict[str, Any]] = []

    for rec in records:
        ticker = str(rec.get("ticker") or "").strip().upper()
        cd_str = str(rec.get("cd_date") or "")[:10]
        if not ticker or not cd_str:
            continue
        try:
            cd = date.fromisoformat(cd_str)
        except ValueError:
            continue
        is_past = cd < today

        # Collect all indicators (global + per-event)
        all_inds: list[dict[str, Any]] = list(rec.get("clinical_indicators") or [])
        for ev in (rec.get("clinical_events") or rec.get("timeline_events") or []):
            if isinstance(ev, dict):
                all_inds.extend(ev.get("indicators") or [])

        if not all_inds:
            continue

        shift_old, n_old = _agg_shift(all_inds, _indicator_unit_score_old, today)
        shift_new, n_new = _agg_shift(all_inds, _indicator_unit_score_new, today)
        delta_pp = round(shift_new - shift_old, 3)

        # Count new fields present
        n_pvalue = sum(1 for i in all_inds if i.get("p_value") and str(i["p_value"]).lower() not in ("null", "n/d"))
        n_maturity = sum(1 for i in all_inds if i.get("data_maturity") and i["data_maturity"] != "not_reported")
        n_soc = sum(1 for i in all_inds if i.get("vs_soc") and str(i["vs_soc"]).lower() not in ("null", "n/d"))
        n_kpi_type = sum(1 for i in all_inds if i.get("kpi_type") and i["kpi_type"] != "other")

        # Cross-reference with past predictions (only possible for past CDs)
        pred_row = None
        dir_hit = None
        if is_past:
            pred_key = f"{ticker}|{cd_str}"
            pred_row = past_map.get(pred_key)
            dir_hit = _direction_hit(pred_row) if pred_row else None

        results.append({
            "ticker": ticker,
            "cd_date": cd_str,
            "is_past": is_past,
            "n_inds": len(all_inds),
            "shift_old_pp": shift_old,
            "shift_new_pp": shift_new,
            "delta_pp": delta_pp,
            "n_pvalue": n_pvalue,
            "n_maturity": n_maturity,
            "n_soc": n_soc,
            "n_kpi_type": n_kpi_type,
            "direction_hit": dir_hit,
        })

    if not results:
        print("No enriched records found.")
        return

    future = [r for r in results if not r["is_past"]]
    past   = [r for r in results if r["is_past"]]
    print(f"  Future CD records (shift analysis only): {len(future)}")
    print(f"  Past   CD records (+ accuracy cross-ref): {len(past)}\n")

    # ── Summary statistics ───────────────────────────────────────────────────

    n = len(results)
    deltas = [r["delta_pp"] for r in results]
    mean_delta = sum(deltas) / n
    improved = sum(1 for d in deltas if d > 0.05)
    worsened = sum(1 for d in deltas if d < -0.05)
    unchanged = n - improved - worsened
    mean_old = sum(r["shift_old_pp"] for r in results) / n
    mean_new = sum(r["shift_new_pp"] for r in results) / n

    rich = [r for r in results if r["n_pvalue"] > 0 or r["n_maturity"] > 0]
    plain = [r for r in results if r["n_pvalue"] == 0 and r["n_maturity"] == 0]

    rich_hit = [r for r in rich if r["direction_hit"] is True]
    rich_miss = [r for r in rich if r["direction_hit"] is False]
    plain_hit = [r for r in plain if r["direction_hit"] is True]
    plain_miss = [r for r in plain if r["direction_hit"] is False]

    def hit_rate(hits, misses):
        total = len(hits) + len(misses)
        return f"{len(hits)/total*100:.1f}% ({len(hits)}/{total})" if total else "n/a"

    print("=" * 60)
    print(f"  Records with clinical indicators (past CD): {n}")
    print(f"  Mean shift_old:  {mean_old:+.3f} pp")
    print(f"  Mean shift_new:  {mean_new:+.3f} pp")
    print(f"  Mean D (new-old): {mean_delta:+.3f} pp")
    print()
    print(f"  Records improved  (D > 0.05 pp): {improved:4d}  ({improved/n*100:.0f}%)")
    print(f"  Records unchanged (|D| <= 0.05): {unchanged:4d}  ({unchanged/n*100:.0f}%)")
    print(f"  Records worsened  (D < -0.05 pp): {worsened:4d}  ({worsened/n*100:.0f}%)")
    print()
    print(f"  Indicators with p-value:     {sum(r['n_pvalue'] for r in results)}")
    print(f"  Indicators with maturity:    {sum(r['n_maturity'] for r in results)}")
    print(f"  Indicators with vs_soc:      {sum(r['n_soc'] for r in results)}")
    print(f"  Indicators with kpi_type:    {sum(r['n_kpi_type'] for r in results)}")
    print()
    print("-- Direction accuracy (cross-ref with past predictions) --")
    print(f"  Rich KPI records  (p_value/maturity present): {len(rich)}")
    print(f"    Direction hit rate: {hit_rate(rich_hit, rich_miss)}")
    print(f"  Plain records (no p_value/maturity):          {len(plain)}")
    print(f"    Direction hit rate: {hit_rate(plain_hit, plain_miss)}")
    print()

    # Top 10 biggest positive shifts
    top = sorted(results, key=lambda r: r["delta_pp"], reverse=True)[:10]
    print("-- Top 10 records by |D shift_pp| --")
    print(f"  {'Ticker':<8} {'CD':>10}  old_pp  new_pp  D_pp  p_vals  hit")
    for r in top:
        hit = "HIT" if r["direction_hit"] else ("MISS" if r["direction_hit"] is False else "?")
        print(
            f"  {r['ticker']:<8} {r['cd_date']:>10}  "
            f"{r['shift_old_pp']:+.2f}   {r['shift_new_pp']:+.2f}   "
            f"{r['delta_pp']:+.2f}  "
            f"p={r['n_pvalue']}  {hit}"
        )
    print("=" * 60)


if __name__ == "__main__":
    main()
