"""Refresh SDS cohort with Cluster A + CT.gov; print before/after sub-index stats."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from prediction.sds.ctgov_study_plan import nct_from_sim_row
from prediction.sds_data import _simulation_tickers, compute_sds_cohort, save_sds_snapshot

SNAP = Path(__file__).resolve().parents[1] / "data" / "sds_snapshot.json"


def stats(rows: list[dict], label: str) -> None:
    keys = ["phase_credibility", "endpoint_credibility", "unmet_need", "market_size"]
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
        print(f"  {k}: unique={len(c)} null={nulls} top={c.most_common(6)}")
    clusters = [
        round((r.get("cluster_scores") or {}).get("catalyst_quality") or 0, 1) for r in rows
    ]
    uniq = sorted(set(clusters))
    print(
        f"  catalyst_quality: unique={len(uniq)} "
        f"min={min(clusters or [0])} max={max(clusters or [0])} values={uniq}"
    )


def main() -> None:
    before_rows: list[dict] = []
    if SNAP.is_file():
        before_rows = json.loads(SNAP.read_text(encoding="utf-8")).get("rows") or []
    stats(before_rows, "BEFORE (snapshot)")

    print("\nRefreshing cohort (cluster_a + CT.gov per ticker)...")
    doc = compute_sds_cohort(fetch_fmp=False, fetch_cluster_a=True)
    after_rows = doc.get("rows") or []
    path = save_sds_snapshot(doc)
    print(f"Saved {doc.get('n')} rows -> {path}")

    stats(after_rows, "AFTER (refresh)")

    sim = _simulation_tickers()
    with_nct = sum(1 for r in sim if nct_from_sim_row(r))
    print(f"\nNCT in simulation: {with_nct}/{len(sim)}")

    print("\nTop endpoint scores:")
    ranked = sorted(
        after_rows,
        key=lambda x: -((x.get("component_raw") or {}).get("endpoint_credibility") or 0),
    )
    for r in ranked[:10]:
        cr = r.get("component_raw") or {}
        print(
            f"  {r.get('ticker')}: phase={cr.get('phase_credibility')} "
            f"endpoint={cr.get('endpoint_credibility')} unmet={cr.get('unmet_need')} "
            f"market={cr.get('market_size')} "
            f"cluster_a={(r.get('cluster_scores') or {}).get('catalyst_quality')}"
        )


if __name__ == "__main__":
    main()
