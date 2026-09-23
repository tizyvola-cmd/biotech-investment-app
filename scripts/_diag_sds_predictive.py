#!/usr/bin/env python3
"""Diagnose SDS predictive value: entry vs live SDS, cohort coverage, directional r."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


def directional_r(xs: list[float], ys: list[float]) -> tuple[float | None, float | None]:
    up_x, up_y, dn_x, dn_y = [], [], [], []
    for x, y in zip(xs, ys):
        if y >= 0:
            up_x.append(x)
            up_y.append(y)
        else:
            dn_x.append(x)
            dn_y.append(y)
    return pearson(up_x, up_y), pearson(dn_x, dn_y)


def load_json(name: str) -> dict | list | None:
    p = DATA / name
    if not p.exists():
        print(f"  MISSING: {p}")
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def main() -> None:
    outcomes = load_json("investment_sim_outcomes.json")
    sds_doc = load_json("sds_snapshot.json")
    sim_doc = load_json("simulation_sheet_snapshot.json")

    if not outcomes:
        return

    rows = outcomes.get("rows") or []
    closed = [r for r in rows if r.get("pnl_pct") is not None and r.get("is_closed")]
    if not closed:
        closed = [r for r in rows if r.get("pnl_pct") is not None]

    live_sds: dict[str, float] = {}
    if sds_doc and sds_doc.get("rows"):
        for sr in sds_doc["rows"]:
            t = str(sr.get("ticker", "")).strip().upper()
            s = sr.get("sds")
            if t and s is not None:
                live_sds[t] = float(s)

    print("=== SDS predictive audit ===")
    print(f"outcomes generated_at: {outcomes.get('generated_at')}")
    print(f"sds snapshot generated_at: {sds_doc.get('generated_at') if sds_doc else '—'}")
    print(f"sim snapshot rows: {len(sim_doc.get('rows') or []) if sim_doc else 0}")
    print(f"closed outcomes: {len(closed)}")

    # Source breakdown
    entry_only, live_only, both, neither = [], [], [], []
    for r in closed:
        tk = str(r.get("ticker", "")).strip().upper()
        entry = r.get("entry_sds_score")
        live = live_sds.get(tk)
        pnl = r.get("pnl_pct")
        if pnl is None:
            continue
        rec = {
            "ticker": tk,
            "row_key": r.get("row_key"),
            "pnl": float(pnl),
            "entry_sds": float(entry) if entry is not None else None,
            "live_sds": live,
            "cd": (r.get("completion_date") or "")[:10],
        }
        if rec["entry_sds"] is not None:
            (entry_only if rec["live_sds"] is None else both).append(rec)
        elif rec["live_sds"] is not None:
            live_only.append(rec)
        else:
            neither.append(rec)

    print(f"\nSDS source on closed deals:")
    print(f"  entry_sds_score present: {len(entry_only) + len(both)}")
    print(f"  live fallback only:       {len(live_only)}")
    print(f"  no SDS at all:            {len(neither)}")

    def report(label: str, recs: list[dict], key: str) -> None:
        pts = [(r[key], r["pnl"]) for r in recs if r[key] is not None]
        if len(pts) < 3:
            print(f"\n{label}: n={len(pts)} — insufficient")
            return
        xs, ys = zip(*pts)
        r_all = pearson(list(xs), list(ys))
        r_up, r_dn = directional_r(list(xs), list(ys))
        wins = sum(1 for y in ys if y >= 0)
        losses = sum(1 for y in ys if y < -2)
        print(f"\n{label}: n={len(pts)}")
        print(f"  r(all) = {r_all:+.3f}" if r_all is not None else "  r(all) = —")
        print(f"  r↑     = {r_up:+.3f}" if r_up is not None else "  r↑     = —")
        print(f"  r↓     = {r_dn:+.3f}" if r_dn is not None else "  r↓     = —")
        print(f"  wins={wins} losses<-2%={losses}")

    all_with_sds = entry_only + both + live_only
    report("ALL closed (entry OR live SDS)", all_with_sds, "entry_sds")
    # re-run with resolved sds
    for r in all_with_sds:
        r["resolved_sds"] = r["entry_sds"] if r["entry_sds"] is not None else r["live_sds"]
    report("ALL closed (resolved SDS = UI logic)", all_with_sds, "resolved_sds")
    report("ENTRY SDS only (immutable)", entry_only + both, "entry_sds")
    report("LIVE SDS fallback only", live_only, "live_sds")

    # Per-ticker table for resolved
    print("\n--- Per deal (resolved SDS) ---")
    print(f"{'ticker':8} {'cd':12} {'sds':>6} {'src':6} {'pnl%':>8}")
    for r in sorted(all_with_sds, key=lambda x: x["pnl"]):
        src = "entry" if r["entry_sds"] is not None else "live"
        sds = r["resolved_sds"]
        print(f"{r['ticker']:8} {r['cd']:12} {sds:6.1f} {src:6} {r['pnl']:+8.1f}")

    # Sim sheet SDS column if present
    if sim_doc:
        sim_rows = sim_doc.get("rows") or []
        sim_sds_cols = set()
        for row in sim_rows[:3]:
            sim_sds_cols.update(k for k in row if "sds" in k.lower() or "SDS" in k)
        print(f"\nSim sheet SDS-related columns: {sorted(sim_sds_cols)}")

    # Check if high r↓ is driven by few loss points
    losses_pts = [(r["resolved_sds"], r["pnl"]) for r in all_with_sds if r["pnl"] < 0]
    if losses_pts:
        print(f"\nLoss deals with SDS: n={len(losses_pts)}")
        for sds, pnl in sorted(losses_pts, key=lambda x: x[1]):
            print(f"  sds={sds:5.1f}  pnl={pnl:+6.1f}%")


def ui_sim_loop_audit() -> None:
    """Replicate ModelComparisonPanel `rows` + SDS correlation (sim loop only)."""
    import re
    from collections import defaultdict

    outcomes = load_json("investment_sim_outcomes.json")
    sds_doc = load_json("sds_snapshot.json")
    if not outcomes:
        return

    live_sds: dict[str, float] = {}
    if sds_doc and sds_doc.get("rows"):
        for sr in sds_doc["rows"]:
            t = str(sr.get("ticker", "")).strip().upper()
            s = sr.get("sds")
            if t and s is not None:
                live_sds[t] = float(s)

    def cycle_index(rk: str) -> int:
        m = re.search(r"#cycle(\d+)", rk or "", re.I)
        return int(m.group(1)) if m else 0

    def base_key(r: dict) -> str:
        raw = (r.get("row_key") or "").strip()
        base = raw.split("#cycle", 1)[0].strip()
        if base:
            return base.upper()
        cd = (r.get("completion_date") or "")[:10]
        tk = str(r.get("ticker", "")).strip().upper()
        return f"{tk}|{cd}"

    def is_open(r: dict) -> bool:
        if isinstance(r.get("decision_current_open"), bool):
            return r["decision_current_open"]
        return not r.get("exit_ts")

    rows = outcomes.get("rows") or []
    closed = [r for r in rows if not is_open(r) and r.get("pnl_pct") is not None]

    by_pos: dict[str, list] = defaultdict(list)
    for r in closed:
        by_pos[base_key(r)].append(r)

    def pick_later(a: dict, b: dict) -> dict:
        from datetime import datetime

        def parse_ts(s: str | None) -> float | None:
            if not s:
                return None
            try:
                return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
            except Exception:
                return None

        a_ts, b_ts = parse_ts(a.get("exit_ts")), parse_ts(b.get("exit_ts"))
        if a_ts is not None and b_ts is not None and a_ts != b_ts:
            return a if a_ts > b_ts else b
        if a_ts is not None and b_ts is None:
            return a
        if a_ts is None and b_ts is not None:
            return b
        ac, bc = cycle_index(a.get("row_key", "")), cycle_index(b.get("row_key", ""))
        if ac != bc:
            return a if ac > bc else b
        return a if (a.get("pnl_pct") or -1e9) >= (b.get("pnl_pct") or -1e9) else b

    collapsed: list[dict] = []
    for grp in by_pos.values():
        with_cycle = [r for r in grp if cycle_index(r.get("row_key", "")) > 0]
        pool = with_cycle or grp
        best = pool[0]
        for r in pool[1:]:
            best = pick_later(best, r)
        collapsed.append(best)

    def resolve_sds(r: dict) -> tuple[float | None, str | None]:
        entry = r.get("entry_sds_score")
        if entry is not None:
            return float(entry), "entry"
        tk = str(r.get("ticker", "")).strip().upper()
        if tk in live_sds:
            return live_sds[tk], "live"
        return None, None

    print("\n=== UI sim-loop rows (collapsed) ===")
    print(f"n closed collapsed: {len(collapsed)}")
    pts = []
    for r in collapsed:
        sds, src = resolve_sds(r)
        if sds is not None:
            pts.append({"sds": sds, "pnl": float(r["pnl_pct"]), "ticker": r["ticker"], "src": src})
    print(f"with SDS: {len(pts)} / {len(collapsed)}")
    xs = [p["sds"] for p in pts]
    ys = [p["pnl"] for p in pts]
    r_all = pearson(xs, ys)
    wins = [p for p in pts if p["pnl"] > 0]
    loss = [p for p in pts if p["pnl"] < 0]
    r_up = pearson([p["sds"] for p in wins], [p["pnl"] for p in wins])
    r_dn = pearson([p["sds"] for p in loss], [p["pnl"] for p in loss])
    print(f"r(all) = {r_all:+.3f}" if r_all else "r(all) = —")
    print(f"r↑ (pnl>0) = {r_up:+.3f} n={len(wins)}" if r_up else f"r↑ = — n={len(wins)}")
    print(f"r↓ (pnl<0) = {r_dn:+.3f} n={len(loss)}" if r_dn else f"r↓ = — n={len(loss)}")
    print(f"entry_sds: {sum(1 for p in pts if p['src']=='entry')}  live_fallback: {sum(1 for p in pts if p['src']=='live')}")

    entry_pts = [p for p in pts if p["src"] == "entry"]
    if len(entry_pts) >= 3:
        r_e = pearson([p["sds"] for p in entry_pts], [p["pnl"] for p in entry_pts])
        print(f"ENTRY ONLY r = {r_e:+.3f} n={len(entry_pts)}" if r_e else "")

    print(f"sds snapshot n (cohort): {sds_doc.get('n') if sds_doc else '—'}")

    print("\nLoss deals with SDS (sim-loop):")
    for p in sorted([p for p in pts if p["pnl"] < 0], key=lambda x: x["pnl"]):
        print(f"  {p['ticker']:6} pnl={p['pnl']:+6.1f} sds={p['sds']:5.1f} ({p['src']})")

    no_sds = [r for r in collapsed if resolve_sds(r)[0] is None]
    print(f"\nClosed without any SDS: {len(no_sds)}")
    for r in sorted(no_sds, key=lambda x: abs(float(x.get('pnl_pct') or 0)), reverse=True)[:8]:
        print(f"  {r['ticker']:6} pnl={float(r['pnl_pct']):+6.1f} entry_sds={r.get('entry_sds_score')}")


if __name__ == "__main__":
    main()
    ui_sim_loop_audit()
