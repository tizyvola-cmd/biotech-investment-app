"""
Valutazione per strato: modello base vs seq recalib vs foglio vs daily open.
Usa simulation_charts_snapshot.json + price cache + simulation sheet.
"""
from __future__ import annotations

import json
import pickle
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def parse_cd(s: str) -> date | None:
    if not s:
        return None
    s = str(s).strip()
    if "/" in s:
        d, m, y = s.split("/")
        return date(int(y), int(m), int(d))
    return date.fromisoformat(s[:10])


def interpolate(series: list[tuple[float, float]], target: float) -> float | None:
    if not series:
        return None
    s = sorted(series, key=lambda x: x[0])
    if target <= s[0][0]:
        return s[0][1]
    if target >= s[-1][0]:
        return s[-1][1]
    for i in range(len(s) - 1):
        a, b = s[i], s[i + 1]
        if a[0] <= target <= b[0]:
            if b[0] == a[0]:
                return a[1]
            t = (target - a[0]) / (b[0] - a[0])
            return a[1] + t * (b[1] - a[1])
    return None


def load_closes(ticker: str) -> tuple[list[date], list[float]] | None:
    pkl = DATA / "price_cache" / f"{ticker}_60d_cv.pkl"
    if not pkl.exists():
        return None
    raw = pickle.load(open(pkl, "rb"))
    closes = raw.get("close") if isinstance(raw, dict) else None
    if closes is None:
        return None
    closes = closes.dropna()
    dates = [datetime.fromisoformat(str(ix)[:10]).date() for ix in closes.index]
    return dates, [float(x) for x in closes.values]


def close_on(dates: list[date], prices: list[float], d: date) -> float | None:
    for i, dt in enumerate(dates):
        if dt == d:
            return prices[i]
    return None


def pct_vs_p60(price: float, p60: float) -> float:
    return round((price / p60 - 1) * 100, 4)


def build_series(points: list[dict], field: str) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    seen: set[float] = set()
    for p in points:
        v = p.get(field)
        if v is None:
            continue
        off = float(p["offset"])
        if off in seen:
            continue
        seen.add(off)
        out.append((off, float(v)))
    return out


def apply_daily_shift(series: list[tuple[float, float]], now_off: float, live_pct: float) -> list[tuple[float, float]]:
    model_at = interpolate(series, now_off)
    if model_at is None:
        return series
    shift = live_pct - model_at
    if abs(shift) < 0.02:
        return series
    out: list[tuple[float, float]] = []
    for off, y in series:
        if off < now_off - 0.01:
            out.append((off, y))
        else:
            out.append((off, round(y + shift, 4)))
    if not any(abs(o - now_off) < 0.01 for o, _ in out):
        out.append((now_off, live_pct))
    return sorted(out, key=lambda x: x[0])


def pred_forward_delta(series: list[tuple[float, float]], now_off: float, days: float = 1.0) -> float | None:
    at = interpolate(series, now_off)
    ahead = interpolate(series, now_off + days)
    if at is None or ahead is None:
        return None
    return round(ahead - at, 4)


def ols_slope_pp_d(series: list[tuple[float, float]]) -> float | None:
    if len(series) < 2:
        return None
    n = len(series)
    sx = sy = sxy = sxx = 0.0
    for x, y in series:
        sx += x
        sy += y
        sxy += x * y
        sxx += x * x
    den = n * sxx - sx * sx
    if abs(den) < 1e-12:
        return None
    return round((n * sxy - sx * sy) / den, 4)


def window_slope(series: list[tuple[float, float]], now_off: float, half: float = 5.0) -> float | None:
    pts = [(o, y) for o, y in series if now_off - half <= o <= now_off + half]
    if len(pts) < 2:
        pts = [(o, y) for o, y in series if o <= now_off]
    return ols_slope_pp_d(pts)


def main() -> None:
    charts = json.loads((DATA / "simulation_charts_snapshot.json").read_text(encoding="utf-8"))
    sheet = json.loads((DATA / "simulation_sheet_snapshot.json").read_text(encoding="utf-8"))
    rows_by_tk = {
        str(r["Ticker"]).upper(): r
        for r in sheet["rows"]
        if r.get("Ticker") and r["Ticker"] != "TOTALE PORTAFOGLIO"
    }

    loaded = charts.get("loaded_at", "2026-06-05")
    eval_end = date.fromisoformat(str(loaded)[:10])
    sessions = [(eval_end - timedelta(days=2), eval_end - timedelta(days=1)), (eval_end - timedelta(days=1), eval_end)]

    layers = [
        ("modello", "pct_modello"),
        ("seq_recalib", "pct_curva"),
        ("foglio", "pct_foglio"),
        ("daily_live", "pct_foglio"),  # + shift storico
    ]
    slope_layers = [
        ("slope_modello", "pct_modello"),
        ("slope_seq", "pct_curva"),
        ("slope_daily", "pct_foglio"),
    ]

    per_ticker: list[dict] = []
    agg: dict[str, dict[str, list[float]]] = {}
    for sk in ("d1", "d2", "cum2"):
        agg[sk] = {lay[0]: {"err1": [], "err2": [], "dir1": []} for lay in layers}
        for sl in slope_layers:
            agg[sk][sl[0]] = {"err1": [], "err2": [], "dir1": []}

    for key, ser in charts.get("series", {}).items():
        if not key.startswith("co:"):
            continue
        tk_cd = key[3:]
        tk, _, cd_s = tk_cd.partition("|")
        tk = tk.upper()
        cd = date.fromisoformat(cd_s)
        points = ser.get("points") or []
        if not points:
            continue

        row = rows_by_tk.get(tk)
        hist = load_closes(tk)
        if hist is None:
            continue
        dates, prices = hist

        p60_pt = None
        for p in points:
            if abs(float(p.get("offset", 999)) + 60) < 1:
                px = p.get("price_storico_usd") or p.get("price_usd")
                if px and float(px) > 0:
                    p60_pt = float(px)
                    break
        if p60_pt is None and row:
            for k in ("Prezzo T−60 ($)", "Prezzo T-60 ($)"):
                v = row.get(k)
                if v and float(v) > 0:
                    p60_pt = float(v)
                    break
        if not p60_pt:
            continue

        rec: dict = {"ticker": tk, "cd": cd_s, "sessions": {}}

        # cumulative 2d from first session start to eval_end
        d0, d1 = sessions[0][0], sessions[1][1]
        c0 = close_on(dates, prices, d0)
        c2 = close_on(dates, prices, d1)
        if c0 is None or c2 is None:
            continue
        actual_cum2 = pct_vs_p60(c2, p60_pt) - pct_vs_p60(c0, p60_pt)

        for d_start, d_end in sessions:
            c_start = close_on(dates, prices, d_start)
            c_end = close_on(dates, prices, d_end)
            if c_start is None or c_end is None:
                continue
            actual_1d = round((c_end / c_start - 1) * 100, 2)
            now_off = (d_start - cd).days
            live_pct = pct_vs_p60(c_start, p60_pt)

            layer_preds: dict[str, float | None] = {}
            slope_preds: dict[str, float | None] = {}
            for lay_name, field in layers:
                base = build_series(points, field)
                if lay_name == "daily_live":
                    series = apply_daily_shift(base, now_off, live_pct)
                else:
                    series = base
                layer_preds[lay_name] = pred_forward_delta(series, now_off, 1.0)

            for sl_name, field in slope_layers:
                base = build_series(points, field)
                series = apply_daily_shift(base, now_off, live_pct) if sl_name == "slope_daily" else base
                sl = window_slope(series, now_off)
                slope_preds[sl_name] = round(sl, 4) if sl is not None else None

            sess_key = f"{d_start.isoformat()}->{d_end.isoformat()}"
            rec["sessions"][sess_key] = {
                "now_off": now_off,
                "actual_1d": actual_1d,
                "layers": layer_preds,
                "slope_layers": slope_preds,
            }

            for lay_name, _ in layers:
                pred = layer_preds.get(lay_name)
                if pred is None:
                    continue
                err = abs(actual_1d - pred)
                if d_end == eval_end:
                    sk = "d2"
                else:
                    sk = "d1"
                agg[sk][lay_name]["err1"].append(err)
                ap = 1 if actual_1d > 0.1 else (-1 if actual_1d < -0.1 else 0)
                pp = 1 if pred > 0.1 else (-1 if pred < -0.1 else 0)
                if ap != 0 or pp != 0:
                    agg[sk][lay_name]["dir1"].append(ap == pp)

            for sl_name, _ in slope_layers:
                pred = slope_preds.get(sl_name)
                if pred is None:
                    continue
                err = abs(actual_1d - pred)
                sk = "d2" if d_end == eval_end else "d1"
                agg[sk][sl_name]["err1"].append(err)
                ap = 1 if actual_1d > 0.1 else (-1 if actual_1d < -0.1 else 0)
                pp = 1 if pred > 0.1 else (-1 if pred < -0.1 else 0)
                if ap != 0 or pp != 0:
                    agg[sk][sl_name]["dir1"].append(ap == pp)

        # 2d cumulative preds
        now_off0 = (d0 - cd).days
        live0 = pct_vs_p60(c0, p60_pt)
        cum_layers: dict[str, float | None] = {}
        for lay_name, field in layers:
            base = build_series(points, field)
            series = apply_daily_shift(base, now_off0, live0) if lay_name == "daily_live" else base
            cum_layers[lay_name] = pred_forward_delta(series, now_off0, 2.0)
        rec["cum2_actual"] = round(actual_cum2, 2)
        rec["cum2_layers"] = cum_layers
        per_ticker.append(rec)

        for lay_name, _ in layers:
            pred = cum_layers.get(lay_name)
            if pred is not None:
                agg["cum2"][lay_name]["err2"].append(abs(actual_cum2 - pred))

    def mae(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 2) if xs else None

    def hit(xs: list[bool]) -> float | None:
        return round(100 * sum(xs) / len(xs), 1) if xs else None

    print(f"Snapshot charts: {loaded}  |  Sessioni: {sessions[0][0]}->{sessions[0][1]}  e  {sessions[1][0]}->{sessions[1][1]}")
    print(f"Ticker valutati: {len(per_ticker)}\n")

    labels = {
        "modello": "Interp. modello (pct_modello)",
        "seq_recalib": "Interp. seq recalib (pct_curva)",
        "foglio": "Interp. foglio (pct_foglio)",
        "daily_live": "Interp. daily open",
        "slope_modello": "Slope OLS su path modello",
        "slope_seq": "Slope OLS su path seq recalib",
        "slope_daily": "Slope OLS su path daily",
    }

    all_layer_keys = [l[0] for l in layers] + [s[0] for s in slope_layers]

    for sk, title in [
        ("d1", f"Penultima sessione ({sessions[0][0]} -> {sessions[0][1]})"),
        ("d2", f"Ultima sessione ({sessions[1][0]} -> {sessions[1][1]})"),
        ("cum2", f"Cumulativo 2 giorni ({sessions[0][0]} -> {sessions[1][1]})"),
    ]:
        print(f"=== {title} ===")
        err_key = "err1" if sk != "cum2" else "err2"
        for name in all_layer_keys:
            e = mae(agg[sk][name][err_key])
            h = hit(agg[sk][name]["dir1"]) if sk != "cum2" else None
            line = f"  {labels[name]:42} MAE={e}%"
            if h is not None:
                line += f"  dir_hit={h}%"
            print(line)
        print()

    # Delta miglioramento vs modello base
    print("=== Guadagno MAE vs interp. modello (ultima sessione) ===")
    base_mae = mae(agg["d2"]["modello"]["err1"])
    if base_mae:
        for name in all_layer_keys[1:]:
            m = mae(agg["d2"][name]["err1"])
            if m is not None:
                delta = round(base_mae - m, 2)
                sign = "migliore" if delta > 0 else ("uguale" if delta == 0 else "peggiore")
                print(f"  {labels[name]}: {delta:+.2f} pp ({sign})")

    print("\n=== Top miglioramenti daily vs modello (ultima sessione) ===")
    ranked = []
    for rec in per_ticker:
        sk = f"{sessions[1][0].isoformat()}->{sessions[1][1].isoformat()}"
        s = rec["sessions"].get(sk)
        if not s:
            continue
        act = s["actual_1d"]
        m = s["layers"].get("modello")
        d = s["layers"].get("daily_live")
        if m is None or d is None:
            continue
        ranked.append((abs(act - m) - abs(act - d), rec["ticker"], act, m, d))
    ranked.sort(reverse=True)
    for gain, tk, act, m, d in ranked[:8]:
        print(f"  {tk:6} actual {act:+6.2f}%  model {m:+6.2f}%  daily {d:+6.2f}%  gain {gain:+.2f}pp")

    print("\n=== Peggiori con daily vs modello (ultima sessione) ===")
    for gain, tk, act, m, d in ranked[-5:]:
        print(f"  {tk:6} actual {act:+6.2f}%  model {m:+6.2f}%  daily {d:+6.2f}%  gain {gain:+.2f}pp")

    out = DATA / "_eval_layers_last2d.json"
    out.write_text(json.dumps({"sessions": [str(s) for s in sessions], "tickers": per_ticker}, indent=2), encoding="utf-8")
    print(f"\nDettaglio salvato in {out}")


if __name__ == "__main__":
    main()
