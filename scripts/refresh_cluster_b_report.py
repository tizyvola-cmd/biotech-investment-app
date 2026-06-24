"""Refresh SDS cohort with Cluster B (FMP short + analyst); print before/after stats."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env", override=False)
except ImportError:
    pass

from prediction.sds_data import compute_sds_cohort, save_sds_snapshot
from prediction.sds_data_collector import fmp_api_key

SNAP = ROOT / "data" / "sds_snapshot.json"


def stats(rows: list[dict], label: str) -> None:
    keys = ["institutional_delta", "short_interest", "analyst_upgrade"]
    print(f"\n=== {label} (n={len(rows)}) ===")
    for k in keys:
        vals: list[float] = []
        nulls = 0
        for r in rows:
            cr = r.get("component_raw") or {}
            v = cr.get(k)
            if v is None:
                nulls += 1
            else:
                vals.append(round(float(v), 2))
        c = Counter(vals)
        print(f"  {k}: unique={len(c)} null={nulls} top={c.most_common(8)}")

    short_pct_vals = [r.get("short_interest_pct") for r in rows if r.get("short_interest_pct") is not None]
    analyst_vals = [r.get("analyst_upgrade_score") for r in rows if r.get("analyst_upgrade_score") is not None]
    print(f"  short_interest_pct (raw): filled={len(short_pct_vals)}/{len(rows)}")
    if short_pct_vals:
        print(f"    range {min(short_pct_vals):.2f}% – {max(short_pct_vals):.2f}%")
    short_scores = [cr.get("short_interest") for r in rows if (cr := r.get("component_raw") or {}).get("short_interest") is not None]
    if short_scores:
        print(f"  short_interest component scores: unique={len(set(short_scores))} top={Counter(short_scores).most_common(6)}")
    print(f"  analyst_upgrade_score (raw): filled={len(analyst_vals)}/{len(rows)}")

    clusters = [
        round((r.get("cluster_scores") or {}).get("institutional_signal") or 0, 1) for r in rows
    ]
    uniq = sorted(set(clusters))
    print(
        f"  institutional_signal cluster: unique={len(uniq)} "
        f"min={min(clusters or [0])} max={max(clusters or [0])} values={uniq[:20]}"
    )


def main() -> None:
    before_rows: list[dict] = []
    if SNAP.is_file():
        before_rows = json.loads(SNAP.read_text(encoding="utf-8")).get("rows") or []
    stats(before_rows, "BEFORE (snapshot)")

    has_fmp = fmp_api_key() is not None
    print(f"\nFMP_API_KEY configured: {has_fmp}")
    if not has_fmp:
        print("  → Short interest + analyst grades require FMP_API_KEY in .env or environment.")
        print("  → Refresh will run but Cluster B components stay null (UI: planned).")

    print("\nRefreshing cohort (Cluster B: FMP + yfinance short; Cluster A from cache)...")
    doc = compute_sds_cohort(fetch_fmp=True, fetch_cluster_a=False)
    after_rows = doc.get("rows") or []
    path = save_sds_snapshot(doc)
    print(f"Saved {doc.get('n')} rows -> {path}")
    print(f"fmp_enabled={doc.get('fmp_enabled')} fmp_fetched={doc.get('fmp_fetched')}")

    stats(after_rows, "AFTER (Cluster B refresh)")

    if has_fmp:
        print("\nTop institutional_signal scores:")
        ranked = sorted(
            after_rows,
            key=lambda x: -((x.get("cluster_scores") or {}).get("institutional_signal") or 0),
        )
        for r in ranked[:10]:
            cr = r.get("component_raw") or {}
            print(
                f"  {r.get('ticker')}: short={cr.get('short_interest')} "
                f"analyst={cr.get('analyst_upgrade')} "
                f"short_pct={r.get('short_interest_pct')} "
                f"cluster_b={(r.get('cluster_scores') or {}).get('institutional_signal')}"
            )


if __name__ == "__main__":
    main()
