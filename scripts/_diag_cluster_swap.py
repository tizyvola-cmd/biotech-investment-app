#!/usr/bin/env python3
"""Compare k-means cluster 0/1 means (SuperNova vs majority)."""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from plot_predizione_guida import compute_bundle
from ristretta_lab_data import load_past_pred_map


def main() -> int:
    from prediction.clustering import cluster_trajectories
    from prediction.config import get_config
    from plot_predizione_guida import (
        CLOSE_SPEC,
        _COLS_N,
        _primary_eligible,
        _px,
        compute_bundle,
    )

    pp = load_past_pred_map()
    b = compute_bundle(pp, pp)
    clusters = b.get("clusters") or {}
    reliable = b.get("cluster_reliable")
    print(f"n_cohort={b.get('n_cohort')} reliable={reliable}")

    cfg = get_config()
    cohort = [
        k
        for k in sorted(pp.keys())
        if _primary_eligible(pp.get(k) or {}, k, pp, pp)
    ]
    features: dict[str, list] = {}
    for ck in cohort:
        dd = pp.get(ck) or {}
        base = _px(dd, "close_m60", "close_m60_cal")
        if base is None or base <= 0:
            continue
        out = []
        for pri, cal in CLOSE_SPEC:
            pv = _px(dd, pri, cal)
            out.append((pv / base - 1.0) * 100.0 if pv and pv > 0 else None)
        if sum(1 for x in out if x is not None) >= 6:
            features[ck] = out
    cl = cluster_trajectories(features, cohort, config=cfg)
    print(
        f"cluster_trajectories: reliable={cl.reliable} swapped={cl.swapped_supernova} "
        f"n_clusters={cl.n_clusters} note={cl.note[:120] if cl.note else ''}"
    )
    for cid, members in sorted(cl.cluster_keys.items()):
        if cid < 0:
            continue
        print(f"  members cid={cid} n={len(members)} sample={members[:5]}")

    for cid in sorted(clusters.keys()):
        mean = clusters[cid][0]
        peak = max((x for x in mean if x is not None), default=None)
        print(f"bundle cluster {cid}: peak={peak:.2f}% head={mean[:4]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
