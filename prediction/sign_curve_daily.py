"""
Curva pre-CD/post-CD: segno giornaliero e scarto prezzo stimato vs reale.

Schema v3: assi X semplificati (giorni alla CD: −60, −50, … +7), due metriche per coorte
(**retro** = corte storica, **simulation** = voci Simulation con seq_curve / calib).
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

from orchestrator_io_paths import (
    MODEL_SIGN_CURVE_DAILY_JSON,
    PAST_CATALYST_PREDICTIONS_JSON,
)
from past_pred_io import load_past_pred_map, normalize_past_pred_record
from prediction.accuracy_v4_v5 import SIGN_HIT_FLAT_BAND_PP, sign_hit_pp

PRE_CD_CALENDAR_DAYS = 60
POST_CD_CALENDAR_DAYS = 7
DAILY_FLAT_BAND_PP = SIGN_HIT_FLAT_BAND_PP

# Giorni alla CD sull'asse X (offset calendario da CD).
SIGN_CURVE_X_OFFSETS: tuple[int, ...] = (
    -60, -50, -40, -30, -20, -10, -7, -5, -3, -1, 1, 3, 5, 7,
)

DECADE_OFFSETS = frozenset({-60, -50, -40, -30, -20})


def _sign_hit_daily(pred_ret_pp: float, act_ret_pp: float) -> bool:
    hit = sign_hit_pp(pred_ret_pp, act_ret_pp)
    return bool(hit) if hit is not None else False


def _price_level_accuracy_pct(pred_px: float | None, act_px: float | None) -> float | None:
    """
    Quanto il prezzo stimato approssima quello reale (0–100%, più alto = meglio).
    ``100 × (1 − |pred − actual| / actual)``, clampato a [0, 100].
    """
    if pred_px is None or act_px is None:
        return None
    try:
        p = float(pred_px)
        a = float(act_px)
    except (TypeError, ValueError):
        return None
    if p <= 0 or a <= 0:
        return None
    rel = abs(p - a) / a
    return round(max(0.0, min(100.0, (1.0 - rel) * 100.0)), 4)


def _parse_cd(rec: dict) -> date | None:
    cd = rec.get("completion_date")
    if isinstance(cd, date):
        return cd
    if cd:
        try:
            return date.fromisoformat(str(cd).strip()[:10])
        except ValueError:
            return None
    return None


def _x_label(off: int) -> str:
    return str(off)


def _bin_range(off: int) -> tuple[int, int]:
    if off in DECADE_OFFSETS:
        return off, min(-1, off + 9)
    return off, off


def _bin_for_cal_offset(cal_off: int) -> int | None:
    for x in SIGN_CURVE_X_OFFSETS:
        lo, hi = _bin_range(x)
        if lo <= cal_off <= hi:
            return x
    return None


def _load_simulation_keys() -> set[str]:
    try:
        from prediction.calibration import calib_load
    except ImportError:
        return set()
    keys: set[str] = set()
    for r in calib_load():
        if not isinstance(r, dict):
            continue
        if str(r.get("source") or "sim").strip().lower() == "retro":
            continue
        tk = str(r.get("ticker") or "").strip().upper()
        cd = r.get("completion_date")
        if not tk or not cd:
            continue
        keys.add(f"{tk}|{str(cd).strip()[:10]}")
    return keys


def _record_key(rec: dict) -> str | None:
    tk = str(rec.get("ticker") or "").strip().upper()
    cd = _parse_cd(rec)
    if not tk or cd is None:
        return None
    return f"{tk}|{cd.isoformat()}"


def _is_simulation_record(rec: dict, sim_keys: set[str]) -> bool:
    rk = _record_key(rec)
    if rk and rk in sim_keys:
        return True
    sq = rec.get("seq_curve_pct_vs_m60")
    if isinstance(sq, list) and len(sq) >= 3:
        return any(x is not None and x == x for x in sq)
    return False


def _linear_interp_on_knots(pairs: list[tuple[int, float]], cal_off: int) -> float | None:
    if not pairs:
        return None
    pairs = sorted(pairs, key=lambda z: z[0])
    t = int(cal_off)
    if len(pairs) == 1:
        return float(pairs[0][1])
    o0, p0 = pairs[0]
    if t <= o0:
        return float(p0)
    o1, p1 = pairs[-1]
    if t >= o1:
        return float(p1)
    for i in range(len(pairs) - 1):
        o0, p0 = pairs[i]
        o1, p1 = pairs[i + 1]
        if o0 <= t <= o1:
            if o1 == o0:
                return float(p0)
            return float(p0) + (float(t) - float(o0)) / (float(o1) - float(o0)) * (
                float(p1) - float(p0)
            )
    return None


def _actual_close_at_cal_offset(cls, cd: date, cal_off: int) -> float | None:
    import pandas as pd
    import data_orchestrator as orch

    try:
        d = cd + pd.Timedelta(days=int(cal_off))
        v = orch._histlib_close_on_trade_date(cls, d.date() if hasattr(d, "date") else d)
        if v is not None and float(v) > 0:
            return float(v)
    except Exception:
        pass
    return None


def _pred_px_at_offset(
    dd: dict,
    cal_off: int,
    *,
    prefer_seq: bool,
    m60_usd: float | None = None,
) -> float | None:
    import data_orchestrator as orch

    if prefer_seq:
        try:
            from data_orchestrator import SIMULATION_PRED_CAL_OFFSETS

            sq = dd.get("seq_curve_pct_vs_m60")
            p60 = dd.get("seq_curve_t60_usd") or m60_usd
            if isinstance(sq, list) and len(sq) >= len(SIMULATION_PRED_CAL_OFFSETS):
                try:
                    p60f = float(p60)
                except (TypeError, ValueError):
                    p60f = 0.0
                if p60f > 0:
                    knots: list[tuple[int, float]] = []
                    for i, off in enumerate(SIMULATION_PRED_CAL_OFFSETS):
                        if i >= len(sq):
                            break
                        v = sq[i]
                        if v is None or v != v:
                            continue
                        knots.append((int(off), float(v)))
                    pct = _linear_interp_on_knots(knots, int(cal_off))
                    if pct is not None:
                        return round(float(p60f) * (1.0 + float(pct) / 100.0), 6)
        except Exception:
            pass

    base = m60_usd
    if base is None or base <= 0:
        base = orch._sim_grafici_base_m60_usd(dd)
    if base is not None and float(base) > 0:
        try:
            from data_orchestrator import SIMULATION_PRED_CAL_OFFSETS

            pcts = orch._interp_pred_pct_vs_m60_calendar(dd, SIMULATION_PRED_CAL_OFFSETS)
            if isinstance(pcts, list):
                knots = [
                    (int(off), float(pcts[i]))
                    for i, off in enumerate(SIMULATION_PRED_CAL_OFFSETS)
                    if i < len(pcts) and pcts[i] is not None and pcts[i] == pcts[i]
                ]
                pct = _linear_interp_on_knots(knots, int(cal_off))
                if pct is not None:
                    return round(float(base) * (1.0 + float(pct) / 100.0), 6)
        except Exception:
            pass

    def _pred_px(d: dict, k: str):
        return orch._acc_sim_pred_px_at_pct_key(d, k)

    raw = orch._interp_acc_sim_pred_price_on_cal_offsets(dd, int(cal_off), _pred_px)
    if raw is not None and m60_usd and m60_usd > 0:
        m60_pred = orch._interp_acc_sim_pred_price_on_cal_offsets(dd, -60, _pred_px)
        if m60_pred and float(m60_pred) > 0 and abs(float(m60_pred) - 1.0) < 0.01:
            return round(float(raw) * float(m60_usd), 6)
    return raw


def _resolve_open_series(tk: str, ser_cache: dict) -> Any | None:
    """Serie Open da HistLib (se presente nel pickle)."""
    import data_orchestrator as orch

    path = orch._histlib_cv_pickle_path(tk)
    if not os.path.exists(path):
        if len(tk) >= 2 and tk.endswith("W"):
            path = orch._histlib_cv_pickle_path(tk[:-1])
    if not os.path.exists(path):
        return None
    try:
        import pandas as pd

        obj = pd.read_pickle(path)
        if isinstance(obj, dict):
            op = obj.get("open")
            if op is not None and not getattr(op, "empty", True):
                return orch._histlib_normalize_ts_index(op)
    except Exception:
        return None
    return None


def _daily_sessions_for_record(
    rec: dict,
    *,
    today: date | None = None,
    prefer_seq: bool = False,
) -> list[dict]:
    """
    Una riga per seduta di borsa: segno DoD (chiusura) e scarto prezzo % a livello.
    Simulation: stime a apertura/chiusura quando Open è disponibile; altrimenti open = close precedente.
    """
    import pandas as pd

    cd = _parse_cd(rec)
    if cd is None:
        return []
    ref = today or date.today()
    if cd >= ref and not prefer_seq:
        return []

    max_post = min(POST_CD_CALENDAR_DAYS, (ref - cd).days) if cd < ref else 0
    if cd >= ref:
        max_post = 0

    tk = str(rec.get("ticker") or "").strip().upper()
    if not tk:
        return []

    import data_orchestrator as orch

    ser_cache: dict = {}
    cls = orch._histlib_accuracy_sim_resolve_close_series(tk, ser_cache)
    if cls is None or getattr(cls, "empty", True):
        return []

    opens = _resolve_open_series(tk, ser_cache) if prefer_seq else None

    s = cls.dropna().sort_index()
    tscd = pd.Timestamp(cd)
    lo = tscd - pd.Timedelta(days=PRE_CD_CALENDAR_DAYS)
    hi = tscd + pd.Timedelta(days=max(0, max_post))
    window = s[(s.index >= lo) & (s.index <= hi)]
    if window.empty:
        return []

    dd = dict(rec)
    orch._accuracy_sim_impute_missing_pre_cd_model_pcts(dd)
    m60_usd = _actual_close_at_cal_offset(s, cd, -60)
    if m60_usd is None:
        m60_usd = orch._sim_grafici_base_m60_usd(dd)

    rows: list[dict] = []
    prev_close: float | None = None
    prev_pred_close: float | None = None

    for ix in window.index:
        try:
            d = pd.Timestamp(ix).normalize().date()
        except Exception:
            continue
        if d.weekday() >= 5:
            continue
        try:
            act_close = float(window.loc[ix])
        except (TypeError, ValueError):
            continue
        if act_close <= 0:
            continue

        cal_off = (d - cd).days
        if cal_off < -PRE_CD_CALENDAR_DAYS or cal_off > max_post:
            continue
        if cd >= ref and cal_off > 0:
            continue

        pred_close = _pred_px_at_offset(dd, cal_off, prefer_seq=prefer_seq, m60_usd=m60_usd)
        if pred_close is None or pred_close <= 0:
            prev_close = act_close
            prev_pred_close = None
            continue

        act_open = prev_close
        if opens is not None:
            try:
                o = float(opens.loc[ix])
                if o > 0:
                    act_open = o
            except (KeyError, TypeError, ValueError):
                pass

        pred_open = prev_pred_close if prev_pred_close and prev_pred_close > 0 else pred_close
        if prefer_seq and prev_pred_close and prev_pred_close > 0:
            pred_open = prev_pred_close

        sign_hit = None
        if prev_close and prev_close > 0:
            act_ret = (act_close - prev_close) / prev_close * 100.0
            pred_ret = (pred_close - pred_open) / pred_open * 100.0 if pred_open > 0 else None
            if pred_ret is not None:
                sign_hit = _sign_hit_daily(pred_ret, act_ret)

        curve_err_pct = None
        acc_samples: list[float] = []
        close_acc = _price_level_accuracy_pct(pred_close, act_close)
        if close_acc is not None:
            acc_samples.append(close_acc)
        if prefer_seq and pred_open and pred_open > 0 and act_open and act_open > 0:
            open_acc = _price_level_accuracy_pct(pred_open, act_open)
            if open_acc is not None:
                acc_samples.append(open_acc)
        price_accuracy_pct = (
            round(sum(acc_samples) / len(acc_samples), 4) if acc_samples else None
        )

        rows.append({
            "cal_offset": int(cal_off),
            "zone": "pre_cd" if cal_off < 0 else ("cd" if cal_off == 0 else "post_cd"),
            "sign_hit": sign_hit,
            "price_accuracy_pct": price_accuracy_pct,
            "date": d.isoformat(),
        })

        prev_close = act_close
        prev_pred_close = pred_close

    return rows


def _aggregate_sessions(sessions: list[dict]) -> dict[str, Any]:
    by_x: dict[int, list[dict]] = defaultdict(list)
    for s in sessions:
        x = _bin_for_cal_offset(int(s["cal_offset"]))
        if x is not None:
            by_x[x].append(s)

    by_offset: list[dict] = []
    pre_hits = pre_n = 0
    all_hits = all_n = 0
    pre_price: list[float] = []
    all_price: list[float] = []

    for off in SIGN_CURVE_X_OFFSETS:
        pts = by_x.get(off, [])
        if not pts:
            continue
        hits = [p["sign_hit"] for p in pts if p.get("sign_hit") is not None]
        prices = []
        for p in pts:
            v = p.get("price_accuracy_pct")
            if v is None:
                v = p.get("price_err_pct")
            if v is not None:
                try:
                    prices.append(float(v))
                except (TypeError, ValueError):
                    pass
        bh = sum(1 for h in hits if h)
        bn = len(hits)
        sign_pct = round(bh / bn * 100.0, 2) if bn else None
        price_pct = round(sum(prices) / len(prices), 2) if prices else None
        by_offset.append({
            "offset": off,
            "label": _x_label(off),
            "zone": "pre_cd" if off < 0 else "post_cd",
            "sign_hit_pct": sign_pct,
            "price_accuracy_pct": price_pct,
            "n": bn,
            "n_price": len(prices),
        })
        all_n += bn
        all_hits += bh
        all_price.extend(prices)
        if off < 0:
            pre_n += bn
            pre_hits += bh
            pre_price.extend(prices)

    return {
        "by_offset": by_offset,
        "overall_sign_hit_pct": round(all_hits / all_n * 100.0, 2) if all_n else None,
        "overall_sign_hit_pre_cd_pct": round(pre_hits / pre_n * 100.0, 2) if pre_n else None,
        "overall_price_accuracy_pct": round(sum(all_price) / len(all_price), 2) if all_price else None,
        "overall_price_accuracy_pre_cd_pct": round(sum(pre_price) / len(pre_price), 2) if pre_price else None,
        "overall_price_err_pct": round(sum(all_price) / len(all_price), 2) if all_price else None,
        "n_sessions": all_n,
        "n_sessions_pre_cd": pre_n,
    }


def _iso_week(date_str: str | None) -> str | None:
    if not date_str:
        return None
    try:
        d = date.fromisoformat(str(date_str)[:10])
    except ValueError:
        return None
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def _weekly_pre_cd_series(sessions: list[dict], limit: int = 12) -> list[dict[str, Any]]:
    """Retroactive weekly trend of pre-CD quality, bucketing sessions by the ISO
    calendar week of the trading day (mixes catalysts, but gives an immediate signal).
    """
    by_week: dict[str, list[dict]] = defaultdict(list)
    for s in sessions:
        if int(s.get("cal_offset", 0)) >= 0:
            continue  # pre-CD only
        wk = _iso_week(s.get("date"))
        if wk:
            by_week[wk].append(s)
    out: list[dict[str, Any]] = []
    for wk in sorted(by_week)[-limit:]:
        pts = by_week[wk]
        hits = [bool(p["sign_hit"]) for p in pts if p.get("sign_hit") is not None]
        prices = [float(p["price_accuracy_pct"]) for p in pts if p.get("price_accuracy_pct") is not None]
        out.append({
            "week": wk,
            "n": len(hits),
            "sign_hit_pct": round(sum(hits) / len(hits) * 100.0, 2) if hits else None,
            "price_accuracy_pct": round(sum(prices) / len(prices), 2) if prices else None,
        })
    return out


def _build_cohort(
    records: list[dict],
    *,
    today: date,
    prefer_seq: bool,
    label: str = "cohort",
) -> dict[str, Any]:
    all_sessions: list[dict] = []
    n_events = 0
    n_skipped = 0
    total = len(records)
    step = max(50, total // 20) if total else 50

    if total > 0:
        print(
            f"[SignCurveDaily] {label}: 0/{total} trial …",
            flush=True,
        )

    for i, rec in enumerate(records, start=1):
        cd = _parse_cd(rec)
        if cd is None:
            n_skipped += 1
            continue
        if not prefer_seq and cd >= today:
            n_skipped += 1
            continue
        sess = _daily_sessions_for_record(rec, today=today, prefer_seq=prefer_seq)
        if sess:
            n_events += 1
            all_sessions.extend(sess)
        else:
            n_skipped += 1

        if total > 0 and (i == 1 or i % step == 0 or i == total):
            print(
                f"[SignCurveDaily] {label}: {i}/{total} trial "
                f"({n_events} ok, {len(all_sessions)} sedute) …",
                flush=True,
            )

    agg = _aggregate_sessions(all_sessions)
    return {
        "n_events": n_events,
        "n_events_skipped": n_skipped,
        "weekly_pre_cd": _weekly_pre_cd_series(all_sessions),
        **agg,
    }


def build_sign_curve_daily_snapshot(
    *,
    past_pred_path: str | Path | None = None,
    today: date | None = None,
    max_rows: int | None = None,
) -> dict[str, Any]:
    ref = today or date.today()
    print("[SignCurveDaily] Carico past_pred …", flush=True)
    raw_map = load_past_pred_map(str(past_pred_path or PAST_CATALYST_PREDICTIONS_JSON))
    rows = [normalize_past_pred_record(v) for v in raw_map.values() if isinstance(v, dict)]
    print(f"[SignCurveDaily] {len(rows)} record caricati", flush=True)

    try:
        cap = int(os.environ.get("SIGN_CURVE_DAILY_MAX_ROWS", "0").strip() or "0")
    except ValueError:
        cap = 0
    if max_rows is not None:
        cap = max_rows
    if cap > 0:
        rows = rows[:cap]

    sim_keys = _load_simulation_keys()
    retro_recs: list[dict] = []
    sim_recs: list[dict] = []
    seen_sim: set[str] = set()

    for rec in rows:
        if _is_simulation_record(rec, sim_keys):
            rk = _record_key(rec)
            if rk:
                seen_sim.add(rk)
            sim_recs.append(rec)
        else:
            cd = _parse_cd(rec)
            if cd is not None and cd < ref:
                retro_recs.append(rec)

    # Aggiungi voci calib Simulation non ancora nel past_pred map.
    try:
        from prediction.calibration import calib_load

        for r in calib_load():
            if not isinstance(r, dict):
                continue
            if str(r.get("source") or "sim").strip().lower() == "retro":
                continue
            tk = str(r.get("ticker") or "").strip().upper()
            cd = _parse_cd(r)
            if not tk or cd is None:
                continue
            rk = f"{tk}|{cd.isoformat()}"
            if rk in seen_sim:
                continue
            base = raw_map.get(rk) if isinstance(raw_map, dict) else None
            if isinstance(base, dict):
                sim_recs.append(normalize_past_pred_record(base))
            else:
                sim_recs.append(normalize_past_pred_record({
                    "ticker": tk,
                    "completion_date": cd,
                    **{k: v for k, v in r.items() if k not in ("ticker", "completion_date")},
                }))
            seen_sim.add(rk)
    except Exception:
        pass

    retro = _build_cohort(retro_recs, today=ref, prefer_seq=False, label="retro")
    simulation = _build_cohort(sim_recs, today=ref, prefer_seq=True, label="simulation")

    return {
        "schema_version": 3,
        "generated_at": datetime.now().replace(microsecond=0).isoformat(),
        "window_calendar_days_pre_cd": PRE_CD_CALENDAR_DAYS,
        "window_calendar_days_post_cd": POST_CD_CALENDAR_DAYS,
        "flat_band_pp": DAILY_FLAT_BAND_PP,
        "x_offsets": list(SIGN_CURVE_X_OFFSETS),
        "metric_sign": "daily_dod_sign_pred_vs_actual",
        "metric_price": "price_level_accuracy_pct",
        "definition_it": (
            "Asse X: giorni alla CD (−60…+7). Grafico 1: % sedute con segno DoD stimato = reale. "
            "Grafico 2: accuratezza prezzo 0–100% = quanto prezzo modello ≈ prezzo reale (chiusura; "
            "Simulation anche apertura se disponibile)."
        ),
        "definition_en": (
            "X-axis: days to CD (−60…+7). Chart 1: % sessions with matching day sign. "
            "Chart 2: price accuracy 0–100% = how close model price is to actual (close; "
            "Simulation also open when available)."
        ),
        "cohorts": {
            "retro": {
                "label_it": "Corte storica",
                "label_en": "Historical cohort",
                **retro,
            },
            "simulation": {
                "label_it": "Simulation",
                "label_en": "Simulation",
                **simulation,
            },
        },
        # Legacy aliases (v2 consumers)
        "overall": {
            "hit_pct": retro.get("overall_sign_hit_pct"),
            "hit_pct_pre_cd": retro.get("overall_sign_hit_pre_cd"),
            "n_pairs": retro.get("n_sessions"),
            "mag_err_when_hit_pp": None,
        },
        "by_time_bin": retro.get("by_offset", []),
        "n_events": retro.get("n_events"),
    }


def save_sign_curve_daily_json(
    snap: dict[str, Any] | None = None,
    *,
    path: str | Path | None = None,
    **build_kw: Any,
) -> dict[str, Any]:
    if snap is None:
        print(
            "[SignCurveDaily] Avvio (può richiedere 2–5 min su ~8400 trial; attendere) …",
            flush=True,
        )
    doc = snap if isinstance(snap, dict) else build_sign_curve_daily_snapshot(**build_kw)
    p = Path(path or MODEL_SIGN_CURVE_DAILY_JSON)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    retro = (doc.get("cohorts") or {}).get("retro") or doc.get("overall") or {}
    sim = (doc.get("cohorts") or {}).get("simulation") or {}
    print(
        "[SignCurveDaily] "
        f"retro sign={retro.get('overall_sign_hit_pct', retro.get('hit_pct'))}% "
        f"price={retro.get('overall_price_accuracy_pct', retro.get('overall_price_err_pct'))}% · "
        f"sim sign={sim.get('overall_sign_hit_pct')}% "
        f"price={sim.get('overall_price_accuracy_pct', sim.get('overall_price_err_pct'))}% "
        f"→ {p}",
        flush=True,
    )
    return doc
