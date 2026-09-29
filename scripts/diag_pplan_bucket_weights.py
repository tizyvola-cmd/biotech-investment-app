"""Read-only diagnosis: P(plan) bucket non-monotonicity in Approved weights."""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from prediction.bayesian_shrinkage import compute_calibration_snapshot
from prediction.calibration_buckets import bucket_pplan, is_win

OUTCOMES = ROOT / "data" / "investment_sim_outcomes.json"
K = 8

USER_TABLE = {
    "P(plan) <30%": (0.563, 2),
    "P(plan) 30-50%": (0.531, 12),
    "P(plan) 50-70%": (0.486, 34),
    "P(plan) ≥70%": (0.766, 15),
}


def safe(s: str) -> str:
    return s.replace("\u2265", ">=").replace("\u2013", "-")


def load_closed() -> list[dict]:
    doc = json.loads(OUTCOMES.read_text(encoding="utf-8"))
    rows = doc.get("rows") or []
    return [r for r in rows if r.get("pnl_pct") is not None and math.isfinite(float(r["pnl_pct"]))]


def pplan_entry(r: dict) -> float | None:
    for k in ("entry_affidabilita_pct", "affidabilita_pct"):
        v = r.get(k)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                pass
    return None


def shrink(raw: float, n: int, prior: float) -> float:
    return (n * raw + K * prior) / (n + K)


def main() -> None:
    closed = load_closed()
    print(f"Closed outcomes: {len(closed)}")
    snap = compute_calibration_snapshot()
    print(f"Engine snapshot totalTrades={snap['totalTrades']} globalPrior={snap['globalPrior']:.4f}")
    print("\n--- shrinkageEngine (pnl > -2%) ---")
    for c in snap["dimensions"]["pplanBucket"]["cells"]:
        if c["n"] > 0:
            print(
                safe(
                    f"  {c['cell']}: n={c['n']} raw={c['rawObserved']:.4f} "
                    f"shrunk={c['shrinkageApplied']:.4f} conf={c['confidence']}"
                )
            )

    win_fns = {
        "pnl>-2 (engine)": lambda r: is_win(r),
        "pnl>0": lambda r: float(r.get("pnl_pct") or 0) > 0,
        "pnl>+1 (flat band)": lambda r: float(r.get("pnl_pct") or 0) > 1.0,
        "is_win flag": lambda r: bool(r.get("is_win")),
        "outcome==success": lambda r: (r.get("outcome") or "") == "success",
    }

    print("\n--- Alternative win definitions (entry P(plan) bucket) ---")
    for name, fn in win_fns.items():
        by: dict[str, list] = defaultdict(list)
        for r in closed:
            p = pplan_entry(r)
            by[bucket_pplan(p)].append(r)
        gp = sum(fn(r) for r in closed) / len(closed)
        print(f"\n{name} global_win={gp:.4f}")
        for cell in ["P(plan) <30%", "P(plan) 30-50%", "P(plan) 50-70%", "P(plan) ≥70%"]:
            rs = by.get(cell, [])
            if not rs:
                continue
            raw = sum(fn(r) for r in rs) / len(rs)
            sh = shrink(raw, len(rs), gp)
            tgt = USER_TABLE.get(cell)
            mark = " <-- 48.6% match" if cell == "P(plan) 50-70%" and abs(raw - 0.486) < 0.002 else ""
            print(safe(f"  {cell}: n={len(rs)} raw={raw:.4f} shrunk={sh:.4f}{mark}"))

    cell_5070 = [
        r
        for r in closed
        if bucket_pplan(pplan_entry(r)) == "P(plan) 50-70%"
    ]
    print(f"\n--- P(plan) 50-70% positions (n={len(cell_5070)}) ---")
    for r in sorted(cell_5070, key=lambda x: float(x.get("pnl_pct") or 0)):
        p = pplan_entry(r)
        pnl = float(r.get("pnl_pct") or 0)
        print(
            f"  {r.get('ticker'):6s} pplan={p:5.1f} pnl={pnl:+6.2f}% "
            f"is_win={r.get('is_win')} outcome={r.get('outcome')} "
            f"key={r.get('row_key', '')[:40]}"
        )

    # Universe tag: sim loop cycles vs single
    cycles = sum(1 for r in cell_5070 if "#" in str(r.get("row_key") or ""))
    print(f"\nSim-loop tagged (#cycle in row_key): {cycles}/{len(cell_5070)}")
    print("(Calibration uses investment_sim_outcomes only — no invest_sim_inputs closed portfolio.)")

    # Alternative bucket borders
    print("\n--- Alt bucket borders (pnl>-2 win rate) ---")
    borders = [(30, 50, 70), (25, 55, 75), (35, 55, 75)]
    for b in borders:
        lo1, lo2, lo3 = b

        def alt_bucket(p: float | None) -> str | None:
            if p is None:
                return None
            if p < lo1:
                return "b1"
            if p < lo2:
                return "b2"
            if p < lo3:
                return "b3"
            return "b4"

        by2: dict[str, list] = defaultdict(list)
        for r in closed:
            ab = alt_bucket(pplan_entry(r))
            if ab:
                by2[ab].append(r)
        wrs = []
        for k in ("b1", "b2", "b3", "b4"):
            rs = by2.get(k, [])
            if rs:
                wrs.append(sum(is_win(r) for r in rs) / len(rs))
        mono = all(wrs[i] <= wrs[i + 1] for i in range(len(wrs) - 1)) if len(wrs) > 1 else True
        print(f"  cuts {b}: n={[len(by2[k]) for k in ('b1','b2','b3','b4')]} wr={[round(x,3) for x in wrs]} monotonic={mono}")


if __name__ == "__main__":
    main()
