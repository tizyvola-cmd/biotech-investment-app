#!/usr/bin/env python3
"""
Counterfactuals the Comparison panel cannot see:

1. Entry: P&L of names that *passed* SDS≥20 · P(plan)≥50 vs names that failed
   only one of those gates (outcomes replay + current Simulation snapshot).
2. SELL: after a real-book close, Yahoo path if we had held vs realized P&L.
   Split by exit depth (deep floor ≤−12% vs G1 zone −12..−2.5 vs shallow).

Run:
  .venv\\Scripts\\python.exe scripts\\diag_rec_counterfactual.py
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "diag_rec_counterfactual.json"

SDS_MIN = 20
PPLAN_MIN = 50
DEEP = -12.0
G1 = -2.5


def load(name: str) -> Any:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def mean(xs: list[float]) -> float | None:
    return round(sum(xs) / len(xs), 2) if xs else None


def med(xs: list[float]) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    return round(s[len(s) // 2], 2)


def winpct(xs: list[float]) -> float | None:
    return round(100 * sum(1 for x in xs if x > 0) / len(xs), 1) if xs else None


def bucket_stats(label: str, xs: list[float]) -> dict[str, Any]:
    return {
        "label": label,
        "n": len(xs),
        "mean": mean(xs),
        "median": med(xs),
        "win_pct": winpct(xs),
        "n_win": sum(1 for x in xs if x > 0),
        "n_loss": sum(1 for x in xs if x < 0),
        "min": round(min(xs), 2) if xs else None,
        "max": round(max(xs), 2) if xs else None,
    }


def pplan_of(r: dict) -> float | None:
    v = r.get("entry_affidabilita_pct")
    if v is None:
        v = r.get("affidabilita_pct")
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def parse_num(v: Any) -> float | None:
    if v is None or v == "" or v == "—":
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(float(v)) else None
    try:
        n = float(str(v).replace("%", "").replace(",", ".").replace("\u2212", "-"))
    except ValueError:
        return None
    return n if math.isfinite(n) else None


def row_get(row: dict, *names: str) -> Any:
    for n in names:
        if n in row:
            return row[n]
    lower = {str(k).lower(): k for k in row}
    for n in names:
        k = lower.get(n.lower())
        if k is not None:
            return row[k]
        for lk, orig in lower.items():
            if n.lower() in lk.replace("\n", " "):
                return row[orig]
    return None


def entry_from_outcomes() -> dict[str, Any]:
    rows = load("investment_sim_outcomes.json").get("rows") or []
    groups: dict[str, list[float]] = defaultdict(list)
    tickers: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        pnl = parse_num(r.get("pnl_pct"))
        if pnl is None:
            continue
        p = pplan_of(r)
        s = parse_num(r.get("entry_sds_score"))
        pok = p is not None and p >= PPLAN_MIN
        if s is None:
            key = "no_sds"
        else:
            sok = s >= SDS_MIN
            if sok and pok:
                key = "pass_both"
            elif (not sok) and pok:
                key = "fail_sds_only"
            elif sok and (not pok):
                key = "fail_p_only"
            else:
                key = "fail_both"
        groups[key].append(pnl)
        tickers[key].append(str(r.get("ticker") or ""))
    order = ["pass_both", "fail_sds_only", "fail_p_only", "fail_both", "no_sds"]
    labels = {
        "pass_both": f"PASS SDS≥{SDS_MIN} & P≥{PPLAN_MIN}",
        "fail_sds_only": f"FAIL SDS only (P≥{PPLAN_MIN})",
        "fail_p_only": f"FAIL P only (SDS≥{SDS_MIN})",
        "fail_both": "FAIL both gates",
        "no_sds": "No SDS at entry",
    }
    return {
        "source": "investment_sim_outcomes.json — entered sim/replay rows, NOT live rejected off-book",
        "caveat": (
            "Almost everyone who got an outcome already has SDS≥20. "
            "This is still a selected population; fail-SDS n will be tiny."
        ),
        "buckets": [
            {**bucket_stats(labels[k], groups.get(k, [])), "tickers": sorted(set(tickers.get(k, [])))[:20]}
            for k in order
        ],
    }


def entry_from_sim_now() -> dict[str, Any]:
    sim = load("simulation_sheet_snapshot.json")
    sds_doc = load("sds_snapshot.json")
    book = load("invest_sim_inputs.json")
    sds_map = {
        str(r.get("ticker") or "").upper(): parse_num(r.get("sds"))
        for r in (sds_doc.get("rows") or [])
    }
    open_tk = set()
    for k, e in (book.get("inputs") or {}).items():
        if not isinstance(e, dict) or e.get("soldAt"):
            continue
        if e.get("ignoreSheet") and not e.get("capital"):
            continue
        open_tk.add(k.split("|")[0].upper())

    groups: dict[str, list[float]] = defaultdict(list)
    meta: dict[str, list[str]] = defaultdict(list)
    n_off = 0
    for row in sim.get("rows") or []:
        tk = str(row_get(row, "Ticker") or "").strip().upper()
        if not tk or tk in open_tk:
            continue
        n_off += 1
        p = parse_num(row_get(row, "Affidabilità\n%", "Affidabilità %", "affid_live", "Plan_Prob_Pct"))
        if p is not None and 0 < p <= 1.5:
            p = p * 100
        s = sds_map.get(tk)
        if s is None:
            s = parse_num(row_get(row, "SDS", "sds_score"))
        var = parse_num(row_get(row, "Var. 1M %", "Var. 1M%"))
        if var is None:
            var = parse_num(row_get(row, "Var. Giorn. %"))
        if var is None:
            continue
        pok = p is not None and p >= PPLAN_MIN
        sok = s is not None and s >= SDS_MIN
        if s is None or p is None:
            key = "missing_score"
        elif sok and pok:
            key = "pass_both"
        elif (not sok) and pok:
            key = "fail_sds_only"
        elif sok and (not pok):
            key = "fail_p_only"
        else:
            key = "fail_both"
        groups[key].append(var)
        meta[key].append(f"{tk} sds={s} p={p} var1m={var}")

    labels = {
        "pass_both": "Off-book PASS both (current sim)",
        "fail_sds_only": "Off-book FAIL SDS only",
        "fail_p_only": "Off-book FAIL P only",
        "fail_both": "Off-book FAIL both",
        "missing_score": "Off-book missing SDS or P",
    }
    return {
        "source": "simulation_sheet_snapshot.json + sds_snapshot.json, off-book only, Var. 1M % (fallback 24h)",
        "caveat": (
            "Contemporaneous proxy, not path-from-decision-date. "
            "Small universe (current Simulation tab). Outcome is trailing variation, not a trade."
        ),
        "n_off_book_rows": n_off,
        "buckets": [
            {**bucket_stats(labels[k], groups.get(k, [])), "examples": meta.get(k, [])[:12]}
            for k in labels
        ],
    }


def classify_exit(pnl: float) -> str:
    if pnl <= DEEP:
        return "deep_floor"
    if pnl <= G1:
        return "g1_zone"
    if pnl < 0:
        return "shallow_loss"
    return "green_or_flat"


def yahoo_closes(tickers: list[str]) -> dict[str, list[tuple[str, float]]]:
    import yfinance as yf

    out: dict[str, list[tuple[str, float]]] = {}
    uniq = sorted({t for t in tickers if t and t.isascii()})
    if not uniq:
        return out
    raw = yf.download(
        uniq,
        period="1y",
        interval="1d",
        auto_adjust=True,
        progress=False,
        threads=True,
        group_by="column",
    )
    if raw is None or getattr(raw, "empty", True):
        return out

    def series_for(tk: str):
        if hasattr(raw.columns, "nlevels") and raw.columns.nlevels > 1:
            if ("Close", tk) in raw.columns:
                return raw[("Close", tk)]
            if (tk, "Close") in raw.columns:
                return raw[(tk, "Close")]
            try:
                return raw["Close"][tk]
            except Exception:
                return None
        return raw["Close"] if "Close" in raw.columns else None

    for tk in uniq:
        ser = series_for(tk) if len(uniq) > 1 else (raw["Close"] if "Close" in raw.columns else series_for(tk))
        if ser is None:
            continue
        bars: list[tuple[str, float]] = []
        for idx, val in ser.items():
            try:
                px = float(val)
            except (TypeError, ValueError):
                continue
            if px != px or px <= 0:
                continue
            day = getattr(idx, "date", lambda: idx)()
            bars.append((str(day)[:10], px))
        out[tk] = bars
    return out


def closest_px(bars: list[tuple[str, float]], day: str, forward: bool) -> tuple[str, float] | None:
    if not bars:
        return None
    if forward:
        later = [b for b in bars if b[0] >= day]
        return later[0] if later else bars[-1]
    earlier = [b for b in bars if b[0] <= day]
    return earlier[-1] if earlier else bars[0]


def px_on_or_after(bars: list[tuple[str, float]], day: str, lag_days: int) -> float | None:
    target = (datetime.fromisoformat(day) + timedelta(days=lag_days)).date().isoformat()
    hit = closest_px(bars, target, forward=True)
    return hit[1] if hit else None


def sell_hold_anyway() -> dict[str, Any]:
    book = load("invest_sim_inputs.json")
    closed: list[dict[str, Any]] = []
    for k, e in (book.get("inputs") or {}).items():
        if not isinstance(e, dict) or not e.get("soldAt"):
            continue
        cap = e.get("closedCapital")
        val = e.get("closedValue")
        if not cap or not val or cap <= 0:
            continue
        pnl = (val - cap) / cap * 100
        sold = str(e["soldAt"])[:10]
        invested = str(e.get("investedAt") or e.get("purchaseDate") or "")[:10]
        tk = k.split("|")[0].upper()
        closed.append(
            {
                "key": k,
                "ticker": tk,
                "sold": sold,
                "invested": invested,
                "realized_pnl_pct": round(pnl, 2),
                "bucket": classify_exit(pnl),
                "holding_days": None,
            }
        )
        if invested:
            try:
                closed[-1]["holding_days"] = (
                    datetime.fromisoformat(sold) - datetime.fromisoformat(invested)
                ).days
            except ValueError:
                pass

    tickers = [c["ticker"] for c in closed]
    print(f"[yahoo] downloading {len(set(tickers))} tickers …", flush=True)
    bars_by = yahoo_closes(tickers)

    rows_out = []
    by_bucket: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for c in closed:
        bars = bars_by.get(c["ticker"]) or []
        sell_px = closest_px(bars, c["sold"], forward=True)
        last = bars[-1] if bars else None
        after_now = None
        after_5 = None
        after_20 = None
        hold_pnl = None
        if sell_px and last and sell_px[1] > 0:
            after_now = round((last[1] / sell_px[1] - 1) * 100, 2)
            p5 = px_on_or_after(bars, c["sold"], 5)
            p20 = px_on_or_after(bars, c["sold"], 20)
            if p5:
                after_5 = round((p5 / sell_px[1] - 1) * 100, 2)
            if p20:
                after_20 = round((p20 / sell_px[1] - 1) * 100, 2)
            hold_pnl = round((1 + c["realized_pnl_pct"] / 100) * (1 + after_now / 100) * 100 - 100, 2)
        rec = {
            **c,
            "sell_px_date": sell_px[0] if sell_px else None,
            "last_px_date": last[0] if last else None,
            "after_sell_to_now_pct": after_now,
            "after_sell_5d_pct": after_5,
            "after_sell_20d_pct": after_20,
            "hold_anyway_pnl_pct": hold_pnl,
            "delta_hold_minus_realized": round(hold_pnl - c["realized_pnl_pct"], 2)
            if hold_pnl is not None
            else None,
            "sold_was_right": after_now is not None and after_now < 0,
            "sold_left_money": after_now is not None and after_now > 0,
        }
        rows_out.append(rec)
        by_bucket[c["bucket"]].append(rec)

    def agg(label: str, recs: list[dict[str, Any]]) -> dict[str, Any]:
        after = [r["after_sell_to_now_pct"] for r in recs if r["after_sell_to_now_pct"] is not None]
        dlt = [r["delta_hold_minus_realized"] for r in recs if r["delta_hold_minus_realized"] is not None]
        realized = [r["realized_pnl_pct"] for r in recs]
        hold = [r["hold_anyway_pnl_pct"] for r in recs if r["hold_anyway_pnl_pct"] is not None]
        n_right = sum(1 for r in recs if r["sold_was_right"])
        n_left = sum(1 for r in recs if r["sold_left_money"])
        n_px = sum(1 for r in recs if r["after_sell_to_now_pct"] is not None)
        return {
            "label": label,
            "n": len(recs),
            "n_with_yahoo": n_px,
            "realized": bucket_stats("realized at sell", realized),
            "after_sell_to_now": bucket_stats("path after sell → now", after),
            "hold_anyway": bucket_stats("P&L if held to now", hold),
            "delta_hold_vs_sold": bucket_stats("hold − realized (pp)", dlt),
            "sold_was_right_n": n_right,
            "sold_left_money_n": n_left,
            "sold_was_right_pct": round(100 * n_right / n_px, 1) if n_px else None,
            "examples": [
                {
                    "ticker": r["ticker"],
                    "sold": r["sold"],
                    "realized": r["realized_pnl_pct"],
                    "after": r["after_sell_to_now_pct"],
                    "hold": r["hold_anyway_pnl_pct"],
                }
                for r in sorted(recs, key=lambda x: -(x["after_sell_to_now_pct"] or 0))[:8]
            ],
        }

    labels = {
        "deep_floor": "Deep floor (realized ≤ −12%) — mechanical SELL, no score needed",
        "g1_zone": "G1 zone (−12% < realized ≤ −2.5%) — score/orphan Soft SELL candidates",
        "shallow_loss": "Shallow loss (−2.5% < realized < 0) — giveback / G2 / continuation / manual",
        "green_or_flat": "Green or flat at sell — not a Soft SELL G1 stop (continuation / manual)",
    }
    return {
        "source": "invest_sim_inputs.json closed book + Yahoo 1d from soldAt → last close",
        "caveat": (
            "We do not have live Reg/Risk/P(plan) at sell time. "
            "Buckets are by realized P&L at exit, which is the observable that Soft SELL G1 "
            "and the deep floor actually key off. after_sell>0 means selling left money on the table."
        ),
        "n_closed": len(closed),
        "n_yahoo_ok": sum(1 for r in rows_out if r["after_sell_to_now_pct"] is not None),
        "overall": agg("all closed", rows_out),
        "buckets": [agg(labels[k], by_bucket.get(k, [])) for k in labels],
        "rows": rows_out,
    }


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "question": (
            "Do SDS≥20 / P(plan)≥50 add entry edge vs names that failed only those gates, "
            "and do SELL exits beat hold-anyway?"
        ),
        "entry_outcomes": entry_from_outcomes(),
        "entry_sim_now": entry_from_sim_now(),
        "sell_hold_anyway": sell_hold_anyway(),
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def show(b: dict) -> None:
        print(
            f"  {b['label']:<44} n={b['n']:>3}  mean={str(b['mean']):>7}  "
            f"med={str(b['median']):>7}  win%={str(b['win_pct']):>6}"
        )

    print("\n=== ENTRY (outcomes replay) ===")
    print(payload["entry_outcomes"]["caveat"])
    for b in payload["entry_outcomes"]["buckets"]:
        show(b)

    print("\n=== ENTRY (current off-book Simulation, Var 1M) ===")
    print(payload["entry_sim_now"]["caveat"], "off-book rows", payload["entry_sim_now"]["n_off_book_rows"])
    for b in payload["entry_sim_now"]["buckets"]:
        show(b)

    print("\n=== SELL hold-anyway (Yahoo after soldAt) ===")
    print(payload["sell_hold_anyway"]["caveat"])
    s = payload["sell_hold_anyway"]
    print(f"closed={s['n_closed']}  yahoo={s['n_yahoo_ok']}")
    for b in [s["overall"], *s["buckets"]]:
        a = b["after_sell_to_now"]
        print(
            f"  {b['label'][:70]}\n"
            f"     n={b['n']} yahoo={b['n_with_yahoo']}  "
            f"after-sell mean={a['mean']} med={a['median']}  "
            f"sold-right {b['sold_was_right_n']}/{b['n_with_yahoo']} ({b['sold_was_right_pct']}%)  "
            f"left-money {b['sold_left_money_n']}"
        )
    print(f"\nWrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
