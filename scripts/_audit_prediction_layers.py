#!/usr/bin/env python3
"""Audit prediction layers (i/ii/iii) for selected tickers — one-off diagnostic."""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

OFFSETS = [-60, -30, -10, -7, -5, -3, 4, 7]


def load_json(name: str):
    p = DATA / name
    if not p.is_file():
        return None
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def cd_to_iso(cd: str) -> str:
    cd = str(cd or "").strip()
    if not cd:
        return ""
    if "T" in cd:
        return cd[:10]
    if re.match(r"^\d{4}-\d{2}-\d{2}", cd):
        return cd[:10]
    if "/" in cd:
        d, m, y = cd.split("/")
        return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
    return cd


def series_key(ticker: str, cd: str) -> str:
    return f"co:{ticker.upper()}|{cd_to_iso(cd)}"


def rmse_at_offsets(points: list[dict], actual: dict[int, float], fields: list[str]) -> tuple[float | None, int]:
    sq, n = 0.0, 0
    by_off = {p["offset"]: p for p in points if p.get("offset") is not None}
    for off, act in actual.items():
        pt = by_off.get(off)
        if not pt:
            continue
        pred = None
        for f in fields:
            v = pt.get(f)
            if v is not None and isinstance(v, (int, float)) and math.isfinite(v):
                pred = float(v)
                break
        if pred is None:
            continue
        sq += (pred - act) ** 2
        n += 1
    if n < 2:
        return None, n
    return math.sqrt(sq / n), n


def find_sim_row(sim_snap: dict, ticker: str) -> dict | None:
    for row in sim_snap.get("rows") or []:
        if str(row.get("Ticker", "")).strip().upper() == ticker.upper():
            return row
    return None


def storico_from_accuracy(acc_row: dict) -> dict[int, float]:
    out: dict[int, float] = {}
    legacy = [
        ("Storico %\nT−60", -60),
        ("Storico %\nT−30", -30),
        ("Storico %\nT−10", -10),
        ("Storico %\nT−7", -7),
        ("Storico %\nT−5", -5),
        ("Storico %\nT−3", -3),
        ("Storico %\nT+4", 4),
        ("Storico %\nT+7", 7),
    ]
    for col, off in legacy:
        v = acc_row.get(col)
        if v is None or v == "" or v == "—":
            continue
        x = pct_from_cell(v)
        if x is not None:
            out[off] = x
    if out:
        return out
    off_re = re.compile(r"T([−+-]?\d+)\s*$")
    for col, v in acc_row.items():
        if "Storico" not in str(col):
            continue
        m = off_re.search(str(col).replace("\n", " "))
        if not m:
            continue
        off_s = m.group(1).replace("−", "-")
        try:
            off = int(off_s)
        except ValueError:
            continue
        x = pct_from_cell(v)
        if x is not None:
            out[off] = x
    return out


def pct_from_cell(v) -> float | None:
    if v is None or v == "" or v == "—":
        return None
    try:
        x = float(str(v).replace(",", ".").replace("%", ""))
        if abs(x) <= 1.5 and "%" not in str(v):
            x *= 100
        return x
    except ValueError:
        return None


def sim_pred_at(row: dict, off: int) -> float | None:
    for k, v in row.items():
        if "Pred" not in k or "Storico" in k or "emp" in k.lower():
            continue
        tail = k.split("\n")[-1].strip()
        want = f"{off:+d}" if off >= 0 else str(off)
        norm = tail.replace("−", "-").replace("+", "+")
        if norm == want.replace("−", "-"):
            return pct_from_cell(v)
    return None


def past_pred_rows(past: dict) -> dict:
    return past.get("rows") or past.get("predictions") or {}


def acc_key(ticker: str, cd: str) -> str:
    return f"{ticker.upper()}|{cd_to_iso(cd)}"


def find_acc_row(acc: dict, ticker: str, cd_iso: str) -> dict | None:
    for row in acc.get("rows") or []:
        tk = str(row.get("Ticker") or "").strip().upper()
        if tk != ticker.upper():
            continue
        cd_raw = row.get("Completion Date") or row.get("CD") or ""
        if cd_to_iso(str(cd_raw)) == cd_iso:
            return row
    return None


def fmt(v) -> str:
    if v is None:
        return "—"
    try:
        return f"{float(v):+.1f}"
    except (TypeError, ValueError):
        return "—"


def layer_deltas(pts: list[dict], off_list: list[int] = OFFSETS) -> None:
    diffs_mr_mc, diffs_mc, diffs_cf, n = [], [], [], 0
    for off in off_list:
        pt = next((p for p in pts if p.get("offset") == off), None)
        if not pt:
            continue
        m, mr, c, f = (
            pt.get("pct_modello"),
            pt.get("pct_modello_raw"),
            pt.get("pct_curva"),
            pt.get("pct_foglio"),
        )
        if mr is not None and m is not None:
            diffs_mr_mc.append(abs(m - mr))
        if m is not None and c is not None:
            diffs_mc.append(abs(c - m))
            n += 1
        if c is not None and f is not None:
            diffs_cf.append(abs(f - c))
    if diffs_mr_mc:
        print(
            f"  |model−raw| mean={sum(diffs_mr_mc)/len(diffs_mr_mc):.2f} pp  "
            f"max={max(diffs_mr_mc):.2f}"
        )
    if diffs_mc:
        print(f"  |curva−model| mean={sum(diffs_mc)/len(diffs_mc):.2f} pp  max={max(diffs_mc):.2f}")
    if diffs_cf:
        print(f"  |foglio−curva| mean={sum(diffs_cf)/len(diffs_cf):.2f} pp  max={max(diffs_cf):.2f}")


def audit_live(
    ticker: str,
    cd_display: str,
    charts: dict,
    sim_snap: dict,
    seq_state: dict,
    clin: dict,
    sec_k8: dict | None = None,
):
    sk = series_key(ticker, cd_display)
    series = (charts.get("series") or {}).get(sk)
    sim_row = find_sim_row(sim_snap, ticker)
    pts = (series or {}).get("points") or []

    cd_iso = sk.split("|", 1)[1]
    seq_ev = (seq_state.get("events") or {}).get(f"{ticker.upper()}|{cd_iso}") or {}

    eis_shift = None
    eis_events = 0
    for rec in clin.get("records") or []:
        if str(rec.get("ticker", "")).upper() != ticker.upper():
            continue
        cd_r = str(rec.get("completion_date") or rec.get("cd") or "")[:10]
        if cd_r and cd_r != cd_iso:
            continue
        sig = rec.get("eis_clinical_signal") or rec.get("clinical_signal") or {}
        eis_shift = sig.get("shift_pp") or sig.get("eis_poly_shift_pp")
        eis_events = int(rec.get("event_count") or sig.get("event_count") or 0)
        break

    sec_filings = 0
    if sec_k8:
        sec_filings = sum(
            1
            for r in sec_k8.get("rows") or []
            if str(r.get("Ticker", "")).upper() == ticker.upper()
        )

    print(f"\n{'='*72}")
    print(f"LIVE  {ticker}  CD {cd_display}  series={sk}")
    print(f"{'='*72}")
    if not pts:
        print("  [no chart points]")
    else:
        k8_nodes = sum(1 for p in pts if (p.get("nodo") or "") in ("K-8", "8-K"))
        ai_nodes = sum(1 for p in pts if (p.get("nodo") or "") == "AI feed")
        has_raw = any(p.get("pct_modello_raw") is not None for p in pts)
        note = seq_ev.get("seq_curve_recalib_note") or seq_ev.get("recalib_note") or "—"
        print(f"  seq note: {str(note)[:120]}")
        print(
            f"  chart nodes: {len(pts)} total, {k8_nodes} x 8-K, {ai_nodes} x AI feed, "
            f"pct_modello_raw={'yes' if has_raw else 'NO (refresh charts)'}"
        )
        print(
            f"  Catalyst Feed: events={eis_events}, shift_pp={eis_shift}  |  "
            f"SEC K-8 sheet filings (ticker): {sec_filings}"
        )
        if sec_filings and k8_nodes == 0:
            print(
                "  ⚠ K-8 data in sec_k8 snapshot but 0 chart nodes — "
                "chart export likely ran without workbook / live fallback"
            )

        if sim_row:
            pred5 = sim_pred_at(sim_row, -5)
            emp5 = pct_from_cell(sim_row.get("Pred empirica\n+5gg (%)"))
            delta_emp = pct_from_cell(sim_row.get("Δ mod vs emp\n+5 (pp)"))
            aff = pct_from_cell(sim_row.get("Affidabilità\ncalib %")) or pct_from_cell(
                sim_row.get("Affidabilità\n%")
            )
            fit = sim_row.get("Curva\n(fit)")
            line = (
                f"  Simulation: fit={fit}, Pred T−5={fmt(pred5)}%, emp+5={fmt(emp5)}%, "
                f"Δmod vs emp={fmt(delta_emp)}pp"
            )
            if aff is not None:
                line += f", affid={aff:.0f}%"
            print(line)

        locked = seq_ev.get("locked_pct") or {}
        if locked and isinstance(locked, dict):
            print(f"  seq locked nodes ({len(locked)}):")
            for off_k, pct in list(locked.items())[:10]:
                print(f"    {off_k}: {pct:+.2f}%")

        hdr = (
            f"{'off':>4}  {'raw':>7}  {'model':>7}  {'seq':>7}  "
            f"{'curva':>7}  {'foglio':>7}  {'reale':>7}  nodo"
        )
        print(hdr)
        for off in OFFSETS:
            pt = next((p for p in pts if p.get("offset") == off), None)
            if not pt:
                continue
            print(
                f"{off:>4}  {fmt(pt.get('pct_modello_raw')):>7}  {fmt(pt.get('pct_modello')):>7}  "
                f"{fmt(pt.get('pct_seq')):>7}  {fmt(pt.get('pct_curva')):>7}  "
                f"{fmt(pt.get('pct_foglio')):>7}  {fmt(pt.get('pct_reale')):>7}  "
                f"{pt.get('nodo') or 'std'}"
            )
        layer_deltas(pts)
        if eis_shift:
            f5 = next((p.get("pct_foglio") for p in pts if p.get("offset") == -5), None)
            if f5 is not None:
                print(f"  UI pct_eis_plus @ T−5 ≈ {f5 + float(eis_shift):.1f} pp (foglio + shift)")


def audit_past(
    ticker: str,
    acc_row: dict,
    past_rec: dict,
    key: str,
    charts: dict | None = None,
):
    cd = str(acc_row.get("Completion Date") or acc_row.get("CD") or "")
    cd_iso = cd_to_iso(cd)
    actual = storico_from_accuracy(acc_row)
    if len(actual) < 4:
        return

    print(f"\n{'='*72}")
    print(f"PAST  {ticker}  CD {cd_iso}  key={key}")
    print(f"{'='*72}")
    print(f"  Storico % nodes: {len(actual)}")

    raw_fit = past_rec.get("pred_dm5_fit_pct") or past_rec.get("model_dm5_fit_pct")
    eis_pp = past_rec.get("eis_poly_shift_pp")
    emp_cat = past_rec.get("emp_curve_pick") or past_rec.get("precat_emp_pick") or "?"
    print(f"  past_pred: raw_dm5_fit={raw_fit}, eis_shift={eis_pp}, emp_pick={emp_cat}")

    seq_list = past_rec.get("seq_curve_pct_vs_m60")
    sk = series_key(ticker, cd_iso)
    chart_pts = ((charts or {}).get("series") or {}).get(sk, {}).get("points") if charts else None

    if chart_pts:
        k8_n = sum(1 for p in chart_pts if (p.get("nodo") or "") in ("K-8", "8-K"))
        print(f"  chart bundle: {len(chart_pts)} pts, {k8_n} K-8 nodes")
        for label, fields in [
            ("raw (pct_modello_raw)", ["pct_modello_raw"]),
            ("model (pct_modello)", ["pct_modello"]),
            ("seq (pct_curva)", ["pct_curva", "pct_seq"]),
            ("foglio", ["pct_foglio"]),
        ]:
            r, n = rmse_at_offsets(chart_pts, actual, fields)
            if r is not None:
                print(f"  RMSE vs Storico chart [{label}] (n={n}): {r:.2f} pp")
        layer_deltas(chart_pts)

    if seq_list and isinstance(seq_list, list):
        idx_off = {off: i for i, off in enumerate(OFFSETS)}
        i5 = idx_off.get(-5)
        seq5 = seq_list[i5] if i5 is not None and i5 < len(seq_list) else None
        st5 = actual.get(-5)
        print(
            f"  layer @ T−5: raw_fit={fmt(raw_fit)}  seq={fmt(seq5)}  "
            f"storico={fmt(st5)}  eis_shift={fmt(eis_pp)}"
        )
        if raw_fit is not None and eis_pp is not None:
            print(f"  raw+EIS (approx) @ T−5: {float(raw_fit) + float(eis_pp):+.1f} pp")
        pts = [
            {
                "offset": off,
                "pct_modello": None,
                "pct_curva": seq_list[i] if i < len(seq_list) else None,
            }
            for i, off in enumerate(OFFSETS)
        ]
        r, n = rmse_at_offsets(pts, actual, ["pct_curva"])
        if r:
            print(f"  RMSE vs Storico (past_pred seq_curve only, n={n}): {r:.2f} pp")

    pred_actual = {}
    for col, off in [
        ("Pred %\nT−60", -60),
        ("Pred %\nT−30", -30),
        ("Pred %\nT−10", -10),
        ("Pred %\nT−7", -7),
        ("Pred %\nT−5", -5),
        ("Pred %\nT−3", -3),
        ("Pred %\nT+4", 4),
        ("Pred %\nT+7", 7),
    ]:
        v = pct_from_cell(acc_row.get(col))
        if v is not None:
            pred_actual[off] = v
    if pred_actual:
        sq, n = 0.0, 0
        for off, act in actual.items():
            if off in pred_actual:
                sq += (pred_actual[off] - act) ** 2
                n += 1
        if n >= 2:
            print(f"  RMSE Accuracy Pred (sheet) vs Storico (n={n}): {math.sqrt(sq/n):.2f} pp")

    for col in acc_row:
        if ("Err" in col or "|Δ|" in col) and "T−5" in col:
            err5 = pct_from_cell(acc_row[col])
            if err5 is not None:
                print(f"  Accuracy |Δ| @ T−5 ({col.split(chr(10))[0]}): {err5:.2f} pp")
                break


def pick_live_with_k8(sim_snap: dict, sec_k8: dict) -> list[tuple[str, str]]:
    sim_by_tk: dict[str, str] = {}
    for row in sim_snap.get("rows") or []:
        tk = str(row.get("Ticker") or "").strip().upper()
        cd = str(row.get("Completion Date") or "").strip()
        if tk and cd:
            sim_by_tk[tk] = cd
    sec_tk = {
        str(r.get("Ticker", "")).strip().upper()
        for r in sec_k8.get("rows") or []
        if r.get("Ticker")
    }
    out: list[tuple[str, str]] = []
    for tk in sorted(sec_tk & set(sim_by_tk)):
        out.append((tk, sim_by_tk[tk]))
    return out


def pick_past_eis_seq(acc: dict, past: dict, limit: int = 3) -> list[tuple[str, dict, dict, str]]:
    rows_map = past_pred_rows(past)
    candidates = []
    for key, rec in rows_map.items():
        eis = rec.get("eis_poly_shift_pp")
        if eis is None or abs(float(eis)) < 0.01:
            continue
        if not rec.get("seq_curve_pct_vs_m60"):
            continue
        if "|" not in key:
            continue
        tk, cd_iso = key.split("|", 1)
        acc_row = find_acc_row(acc, tk, cd_iso)
        if not acc_row:
            continue
        st = storico_from_accuracy(acc_row)
        if len(st) >= 6:
            candidates.append((abs(float(eis)), len(st), tk, acc_row, rec, key))
    candidates.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [(tk, row, rec, key) for _, _, tk, row, rec, key in candidates[:limit]]


def main():
    charts = load_json("simulation_charts_snapshot.json") or {}
    sim_snap = load_json("simulation_sheet_snapshot.json") or {}
    seq_state = load_json("pred_curve_seq_state.json") or {}
    clin = load_json("clinical_pre_cd_enrichment_snapshot.json") or {}
    acc = load_json("accuracy_sheet_snapshot.json") or {}
    past = load_json("past_catalyst_predictions.json") or {}
    sec_k8 = load_json("sec_k8_simulation_snapshot.json") or {}

    # Live portfolio + K-8 overlap (first 5 with filings)
    k8_live = pick_live_with_k8(sim_snap, sec_k8)
    priority = ["PBYI", "BCAB", "BNTX", "PTGX", "OLMA"]
    seen = set()
    live_cases: list[tuple[str, str]] = []
    for tk in priority:
        for t, cd in k8_live:
            if t == tk and t not in seen:
                live_cases.append((t, cd))
                seen.add(t)
    for t, cd in k8_live:
        if t not in seen and len(live_cases) < 6:
            live_cases.append((t, cd))
            seen.add(t)

    print("=" * 72)
    print("TASK 1 — Live tickers with SEC K-8 sheet data (+ portfolio priority)")
    print("=" * 72)
    for tk, cd in live_cases:
        audit_live(tk, cd, charts, sim_snap, seq_state, clin, sec_k8)

    print("\n" + "=" * 72)
    print("TASK 1 — Past CDs with EIS shift + seq_curve (full stack historic)")
    print("=" * 72)
    for tk, row, rec, key in pick_past_eis_seq(acc, past, limit=3):
        audit_past(tk, row, rec, key, charts)

    impact = load_json("curve_impact_cumulative_state.json")
    if impact and impact.get("last_summary"):
        s = impact["last_summary"]
        print(f"\n{'='*72}")
        print("COHORT CUMULATIVE (curve_impact — historic CDs, path RMSE)")
        print(f"{'='*72}")
        labels = [
            ("mae_base_pp", "i) Polinomio base (grey)"),
            ("mae_daily_pp", "ii) + seq/daily recalib"),
            ("mae_k8_pp", "ii) + K8 display overlay"),
            ("mae_eis_pp", "iii) + EIS path"),
            ("delta_mae_daily_vs_base_pp", "Δ daily vs base"),
            ("delta_mae_eis_vs_recalib_pp", "Δ EIS vs recalib"),
            ("hit_base_pct", "Hit% base"),
            ("hit_recalib_pct", "Hit% after recalib"),
        ]
        for k, lab in labels:
            if k in s:
                print(f"  {lab}: {s[k]}")


if __name__ == "__main__":
    main()
