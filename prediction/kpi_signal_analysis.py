"""
KPI Signal Analysis — compares old vs new _indicator_unit_score across
enriched records and writes data/kpi_signal_analysis.json.

Run standalone:  python -m prediction.kpi_signal_analysis
"""
from __future__ import annotations

import json
import math
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[1]
_SNAPSHOT = _ROOT / "data" / "clinical_pre_cd_enrichment_snapshot.json"
_OUT = _ROOT / "data" / "kpi_signal_analysis.json"

ALPHA = 0.35
MAX_PP = 4.0
HALF_LIFE = 21.0

_KPI_W: dict[str, float] = {
    "efficacy": 1.0, "regulatory": 0.9, "biomarker": 0.6,
    "safety": 0.5, "enrollment": 0.2, "other": 0.3,
}
_DM_BONUS: dict[str, float] = {
    "final": 0.30, "primary": 0.15, "interim": 0.00, "not_reported": -0.10,
}


def _pval(text: str) -> float | None:
    m = re.search(r"\d+\.\d+", text or "")
    return float(m.group(0)) if m else None


def _score_old(ind: dict[str, Any]) -> float:
    if not isinstance(ind, dict):
        return 0.0
    s = 0.0
    ep = ind.get("endpoint_met")
    if ep is True:    s += 1.0
    elif ep is False: s -= 1.0
    d = str(ind.get("direction") or "").strip().lower()
    if d == "up":     s += 0.45
    elif d == "down": s -= 0.45
    try:
        nv = ind.get("numeric_value")
        if nv is not None and nv == nv:
            n = float(nv)
            lab = str(ind.get("label") or "").lower()
            if any(k in lab for k in ("orr", "response", "pfs", "os", "survival", "efficacy")):
                if n >= 50:                       s += 0.25
                elif n <= 10 and "orr" in lab:    s -= 0.20
    except (TypeError, ValueError):
        pass
    return s


def _score_new(ind: dict[str, Any]) -> float:
    if not isinstance(ind, dict):
        return 0.0
    s = 0.0
    ep = ind.get("endpoint_met")
    if ep is True:    s += 1.0
    elif ep is False: s -= 1.0
    else:
        d = str(ind.get("direction") or "").strip().lower()
        if d == "up":     s += 0.35
        elif d == "down": s -= 0.35
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
                if n >= 50:                       s += 0.25
                elif n <= 10 and "orr" in lab:    s -= 0.20
    except (TypeError, ValueError):
        pass
    kpi_type = str(ind.get("kpi_type") or "other").lower()
    s *= _KPI_W.get(kpi_type, 0.3)
    return s


def _agg(inds: list[dict[str, Any]], score_fn, today: date) -> float:
    num = den = 0.0
    for ind in inds:
        unit = score_fn(ind)
        if abs(unit) < 1e-6:
            continue
        raw_d = ind.get("indicator_date")
        try:
            ed: date | None = date.fromisoformat(str(raw_d)[:10]) if raw_d else None
        except ValueError:
            ed = None
        age = max(0, (today - ed).days) if ed else 0
        w = math.exp(-age / HALF_LIFE)
        num += unit * w
        den += w
    if den <= 0:
        return 0.0
    mean = num / den
    raw_pp = mean * ALPHA
    return round(max(-MAX_PP, min(MAX_PP, raw_pp)), 3)


def build_analysis() -> dict[str, Any]:
    today = date.today()
    try:
        doc = json.loads(_SNAPSHOT.read_text(encoding="utf-8"))
        records = doc.get("records") or []
    except Exception:
        records = []

    rows: list[dict[str, Any]] = []
    for rec in records:
        ticker = str(rec.get("ticker") or "").strip().upper()
        cd_str = str(rec.get("cd_date") or "")[:10]
        if not ticker or not cd_str:
            continue
        try:
            cd = date.fromisoformat(cd_str)
        except ValueError:
            continue

        all_inds: list[dict[str, Any]] = list(rec.get("clinical_indicators") or [])
        for ev in (rec.get("clinical_events") or rec.get("timeline_events") or []):
            if isinstance(ev, dict):
                all_inds.extend(ev.get("indicators") or [])

        if not all_inds:
            continue

        shift_old = _agg(all_inds, _score_old, today)
        shift_new = _agg(all_inds, _score_new, today)

        n_pvalue  = sum(1 for i in all_inds if i.get("p_value")
                        and str(i["p_value"]).lower() not in ("null", "n/d", ""))
        n_maturity = sum(1 for i in all_inds
                         if i.get("data_maturity") and i["data_maturity"] != "not_reported")
        n_soc     = sum(1 for i in all_inds if i.get("vs_soc")
                        and str(i["vs_soc"]).lower() not in ("null", "n/d", ""))
        n_kpitype = sum(1 for i in all_inds
                        if i.get("kpi_type") and i["kpi_type"] not in ("other", None))
        is_rich   = n_pvalue > 0 or n_maturity > 0

        rows.append({
            "ticker":        ticker,
            "cd_date":       cd_str,
            "is_past":       cd < today,
            "n_inds":        len(all_inds),
            "shift_old_pp":  shift_old,
            "shift_new_pp":  shift_new,
            "delta_pp":      round(shift_new - shift_old, 3),
            "n_pvalue":      n_pvalue,
            "n_maturity":    n_maturity,
            "n_soc":         n_soc,
            "n_kpitype":     n_kpitype,
            "is_rich":       is_rich,
        })

    n = len(rows)
    if n == 0:
        return {"generated_at": datetime.now(timezone.utc).isoformat(),
                "n_enriched": 0, "records": []}

    deltas      = [r["delta_pp"] for r in rows]
    mean_delta  = round(sum(deltas) / n, 3)
    mean_old    = round(sum(r["shift_old_pp"] for r in rows) / n, 3)
    mean_new    = round(sum(r["shift_new_pp"] for r in rows) / n, 3)
    n_improved  = sum(1 for d in deltas if d > 0.05)
    n_worsened  = sum(1 for d in deltas if d < -0.05)
    n_unchanged = n - n_improved - n_worsened
    n_rich      = sum(1 for r in rows if r["is_rich"])

    total_inds  = sum(r["n_inds"] for r in rows)
    total_pval  = sum(r["n_pvalue"] for r in rows)
    total_mat   = sum(r["n_maturity"] for r in rows)
    total_soc   = sum(r["n_soc"] for r in rows)
    total_kpit  = sum(r["n_kpitype"] for r in rows)

    coverage_pct = round(total_pval / total_inds * 100, 1) if total_inds else 0.0

    return {
        "generated_at":    datetime.now(timezone.utc).isoformat(),
        "n_enriched":      n,
        "n_past_cd":       sum(1 for r in rows if r["is_past"]),
        "n_future_cd":     sum(1 for r in rows if not r["is_past"]),
        "n_rich_records":  n_rich,
        "mean_shift_old_pp":  mean_old,
        "mean_shift_new_pp":  mean_new,
        "mean_delta_pp":      mean_delta,
        "n_improved":      n_improved,
        "n_unchanged":     n_unchanged,
        "n_worsened":      n_worsened,
        "total_inds":      total_inds,
        "n_pvalue":        total_pval,
        "n_maturity":      total_mat,
        "n_soc":           total_soc,
        "n_kpitype":       total_kpit,
        "coverage_pct":    coverage_pct,
        "records":         sorted(rows, key=lambda r: abs(r["delta_pp"]), reverse=True),
    }


def write_analysis() -> dict[str, Any]:
    doc = build_analysis()
    _OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    return doc


def load_analysis() -> dict[str, Any]:
    if _OUT.is_file():
        try:
            return json.loads(_OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    return build_analysis()


if __name__ == "__main__":
    doc = write_analysis()
    print(f"Written: {_OUT}")
    print(f"  Enriched records : {doc.get('n_enriched')}")
    print(f"  Rich KPI records : {doc.get('n_rich_records')}")
    print(f"  Mean shift old   : {doc.get('mean_shift_old_pp'):+.3f} pp")
    print(f"  Mean shift new   : {doc.get('mean_shift_new_pp'):+.3f} pp")
    print(f"  Mean delta       : {doc.get('mean_delta_pp'):+.3f} pp")
    print(f"  p-value coverage : {doc.get('coverage_pct')}%  ({doc.get('n_pvalue')}/{doc.get('total_inds')} inds)")
