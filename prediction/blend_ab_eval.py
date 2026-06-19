"""
Layer i A/B: empirical precat blend OFF (raw fit) vs ON (blend / stored model).

Used by ``scripts/compare_blend_ab.py`` and Q&C Validation UI (via evaluationFramework).
"""
from __future__ import annotations

import json
import math
import statistics
from datetime import date, datetime
from pathlib import Path
from typing import Any

from orchestrator_io_paths import (
    PAST_CATALYST_PREDICTIONS_JSON,
    SIMULATION_CHARTS_SNAPSHOT_JSON,
    SIM_LIVE_PRED_SNAPSHOT_JSON,
)

PATH_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3)
FLAT_BAND_PP = 5.0

_HORIZON_KEYS: tuple[tuple[str, int], ...] = (
    ("model_dm60_pct", -60),
    ("model_dm30_pct", -30),
    ("model_dm10_pct", -10),
    ("model_dm7_pct", -7),
    ("model_dm5_pct", -5),
    ("model_dm3_pct", -3),
    ("model_d4_pct", 4),
    ("model_d7_pct", 7),
    ("d3_pct", 3),
    ("d5_pct", 5),
    ("d10_pct", 10),
    ("d30_pct", 30),
)

_FIT_KEY_FOR_MODEL: dict[str, str] = {
    "model_dm60_pct": "model_dm60_fit_pct",
    "model_dm30_pct": "model_dm30_fit_pct",
    "model_dm10_pct": "model_dm10_fit_pct",
    "model_dm7_pct": "model_dm7_fit_pct",
    "model_dm5_pct": "model_dm5_fit_pct",
    "model_dm3_pct": "model_dm3_fit_pct",
    "model_d4_pct": "model_d4_fit_pct",
    "model_d7_pct": "model_d7_fit_pct",
    "d3_pct": "d3_fit_pct",
    "d5_pct": "d5_fit_pct",
    "d10_pct": "d10_fit_pct",
    "d30_pct": "d30_fit_pct",
}

_ROOT = Path(__file__).resolve().parent.parent
_DATA = _ROOT / "data"


def _parse_cd(raw: str | None) -> date | None:
    if not raw:
        return None
    s = str(raw).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(
                s[:10] if fmt == "%Y-%m-%d" else str(raw).strip()[:10], fmt
            ).date()
        except ValueError:
            continue
    if "/" in str(raw):
        try:
            d, m, y = str(raw).strip().split("/")[:3]
            return date(int(y), int(m), int(d))
        except (TypeError, ValueError):
            pass
    return None


def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "—":
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _load_json(path: Path) -> dict | list | None:
    if not path.is_file():
        return None
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_calibration_state() -> dict | None:
    doc = _load_json(_DATA / "model_calibration_state.json")
    return doc if isinstance(doc, dict) else None


def curve_cat_from_row(row: dict) -> str:
    for key in ("emp_curve_cat", "emp_category_dir", "emp_category"):
        v = str(row.get(key) or "").strip().lower()
        if v in ("success", "failure", "neutral", "control"):
            return v
    d = str(row.get("direction") or row.get("dir_v4") or "")
    if d.startswith("↑"):
        return "success"
    if d.startswith("↓"):
        return "failure"
    return "neutral"


def emp_shape_meta(row: dict) -> dict:
    return {
        k: row.get(k)
        for k in ("emp_curve_pick", "precat_pts_ok", "emp_n_sample")
        if row.get(k) is not None
    }


def horizons_off(row: dict) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for mk, _off in _HORIZON_KEYS:
        fk = _FIT_KEY_FOR_MODEL.get(mk, "")
        v = _num(row.get(fk)) if fk else None
        if v is None:
            v = _num(row.get(mk))
        out[mk] = v
    return out


def has_fit_horizons(row: dict) -> bool:
    return any(_num(row.get(fk)) is not None for fk in _FIT_KEY_FOR_MODEL.values())


def pred_raw_fit_at_key(row: dict, model_key: str) -> float | None:
    fk = _FIT_KEY_FOR_MODEL.get(model_key, "")
    if fk:
        v = _num(row.get(fk))
        if v is not None:
            return v
    return _num(row.get(model_key))


def horizons_blended(row: dict, *, calibration_state: dict | None = None) -> dict[str, float | None]:
    from prediction.empirical_precat_blend import apply_empirical_precat_blend

    hz = horizons_off(row)
    cal = calibration_state if calibration_state is not None else load_calibration_state()
    hz_on, _meta = apply_empirical_precat_blend(
        hz,
        calibration_state=cal,
        ver="v4_options",
        curve_cat=curve_cat_from_row(row),
        emp_shape_meta=emp_shape_meta(row),
    )
    return hz_on


def pred_at_model_key(row: dict, model_key: str, *, blended: bool) -> float | None:
    if not blended:
        return pred_raw_fit_at_key(row, model_key)
    if has_fit_horizons(row):
        return _num(row.get(model_key))
    return _num(horizons_blended(row).get(model_key))


def _actual_path_from_rec(row: dict, offsets: tuple[int, ...]) -> list[float | None]:
    from prediction.pre_cd_curve_impact import _actual_path_pct

    path = _actual_path_pct(row, offsets)
    return path if path else [None] * len(offsets)


def _is_standard_point(p: dict) -> bool:
    nodo = str(p.get("nodo") or "standard").strip()
    if nodo in ("standard", "—", ""):
        return True
    return "K-8" not in nodo and nodo not in ("K-8", "8-K", "AI feed")


def _path_from_interp(
    row: dict,
    offsets: tuple[int, ...],
    *,
    blended: bool,
    use_stored_on: bool = False,
) -> list[float | None]:
    import data_orchestrator as orch

    if blended and use_stored_on and has_fit_horizons(row):
        raw = orch._interp_pred_pct_vs_m60_calendar(row, offsets)
    elif blended:
        dd = dict(row)
        hz_on = horizons_blended(row)
        for k, v in hz_on.items():
            if v is not None:
                dd[k] = v
        raw = orch._interp_pred_pct_vs_m60_calendar(dd, offsets)
    else:
        raw = orch._interp_pred_pct_vs_m60_calendar_fit_raw(row, offsets)
        if not isinstance(raw, list) or not any(x is not None for x in raw):
            raw = orch._interp_pred_pct_vs_m60_calendar(row, offsets)
    if not isinstance(raw, list):
        return [None] * len(offsets)
    return [_num(x) for x in raw[: len(offsets)]] + [None] * max(0, len(offsets) - len(raw))


def _rmse_path(
    pred: list[float | None],
    actual: list[float | None],
    offsets: tuple[int, ...],
) -> tuple[float | None, int]:
    sq, n = 0.0, 0
    for p, a, off in zip(pred, actual, offsets):
        if off > 0:
            continue
        if p is None or a is None:
            continue
        sq += (float(p) - float(a)) ** 2
        n += 1
    if n < 2:
        return None, n
    return round(math.sqrt(sq / n), 3), n


def _direction_hit(pred: float, actual: float, band: float = FLAT_BAND_PP) -> bool:
    if abs(actual) <= band:
        return abs(pred) <= band
    return (pred > band and actual > band) or (pred < -band and actual < -band)


def _t5(path: list[float | None], offsets: tuple[int, ...]) -> float | None:
    try:
        i = offsets.index(-5)
    except ValueError:
        return None
    return path[i] if i < len(path) else None


def _summarize_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    if not events:
        return {"n": 0}

    def _mean(field: str) -> float | None:
        vals = [e[field] for e in events if e.get(field) is not None]
        return round(statistics.mean(vals), 3) if vals else None

    wins_on = sum(1 for e in events if e.get("winner") == "on")
    wins_off = sum(1 for e in events if e.get("winner") == "off")
    ties = sum(1 for e in events if e.get("winner") == "tie")
    hit_off = [e["hit_off"] for e in events if e.get("hit_off") is not None]
    hit_on = [e["hit_on"] for e in events if e.get("hit_on") is not None]

    return {
        "n": len(events),
        "rmse_off_mean_pp": _mean("rmse_off_pp"),
        "rmse_on_mean_pp": _mean("rmse_on_pp"),
        "delta_rmse_mean_pp": _mean("delta_rmse_pp"),
        "mae_off_mean_pp": _mean("mae_off_pp"),
        "mae_on_mean_pp": _mean("mae_on_pp"),
        "delta_mae_mean_pp": _mean("delta_mae_pp"),
        "wins_on": wins_on,
        "wins_off": wins_off,
        "ties": ties,
        "hit_off_pct": round(100.0 * sum(hit_off) / len(hit_off), 1) if hit_off else None,
        "hit_on_pct": round(100.0 * sum(hit_on) / len(hit_on), 1) if hit_on else None,
        "n_hit": len(hit_off),
        "n_proxy_raw": sum(1 for e in events if e.get("proxy_raw")),
    }


def evaluate_blend_ab(
    *,
    source: str = "all",
    past_only: bool = True,
    today: date | None = None,
    top_n: int = 5,
) -> dict[str, Any]:
    """
    Cohort A/B layer i. Preferisce live + charts (fit_pct affidabile) su past_pred.
    """
    ref_today = today or date.today()
    events: list[dict[str, Any]] = []

    charts_doc = _load_json(Path(SIMULATION_CHARTS_SNAPSHOT_JSON))
    charts = charts_doc if isinstance(charts_doc, dict) else None

    if source in ("charts", "all") and charts:
        events.extend(_events_from_charts(charts, past_only=past_only, today=ref_today))

    chart_actuals = _chart_actual_lookup(charts)

    if source in ("live", "all"):
        live = _load_json(Path(SIM_LIVE_PRED_SNAPSHOT_JSON))
        if isinstance(live, dict):
            rows = live.get("rows") or {}
            if isinstance(rows, dict):
                events.extend(
                    _events_from_rows(
                        rows,
                        source="live",
                        past_only=past_only,
                        today=ref_today,
                        chart_actuals=chart_actuals,
                    )
                )

    if source in ("past", "all"):
        past = _load_json(Path(PAST_CATALYST_PREDICTIONS_JSON))
        if isinstance(past, dict):
            rows = past.get("rows") or {}
            if isinstance(rows, dict):
                events.extend(
                    _events_from_rows(
                        rows,
                        source="past",
                        past_only=True if source == "past" else past_only,
                        today=ref_today,
                        chart_actuals=None,
                    )
                )

    events = _dedupe_events(events)
    summary = _summarize_events(events)
    ranked = sorted(events, key=lambda e: e.get("delta_rmse_pp") or 0)

    by_src: dict[str, dict[str, Any]] = {}
    for src in ("charts", "live", "past"):
        sub = [e for e in events if e.get("source") == src]
        if sub:
            by_src[src] = _summarize_events(sub)

    verdict = "neutral"
    d = summary.get("delta_rmse_mean_pp")
    if d is not None:
        if d < -0.05:
            verdict = "improved"
        elif d > 0.05:
            verdict = "worse"

    return {
        "metric": "emp_precat_blend_ab",
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_mode": source,
        "past_only": past_only,
        "summary": summary,
        "by_source": by_src,
        "verdict": verdict,
        "top_improvements": [
            {k: e[k] for k in ("key", "ticker", "cd", "delta_rmse_pp", "rmse_off_pp", "rmse_on_pp", "source")}
            for e in ranked[:top_n]
            if e.get("delta_rmse_pp") is not None
        ],
        "top_regressions": [
            {k: e[k] for k in ("key", "ticker", "cd", "delta_rmse_pp", "rmse_off_pp", "rmse_on_pp", "source")}
            for e in ranked[-top_n:][::-1]
            if e.get("delta_rmse_pp") is not None
        ],
    }


def _event_key(ticker: str, cd_iso: str) -> str:
    return f"{ticker.upper()}|{cd_iso}"


def _compare_paths(
    key: str,
    ticker: str,
    cd_iso: str,
    path_off: list[float | None],
    path_on: list[float | None],
    actual: list[float | None],
    *,
    source: str,
    proxy_raw: bool = False,
) -> dict[str, Any] | None:
    rmse_off, n_off = _rmse_path(path_off, actual, PATH_OFFSETS)
    rmse_on, n_on = _rmse_path(path_on, actual, PATH_OFFSETS)
    if rmse_off is None or rmse_on is None:
        return None

    sq_off, sq_on, n_mae = 0.0, 0.0, 0
    for p, q, a, off in zip(path_off, path_on, actual, PATH_OFFSETS):
        if off > 0 or p is None or q is None or a is None:
            continue
        sq_off += abs(float(p) - float(a))
        sq_on += abs(float(q) - float(a))
        n_mae += 1
    mae_off = round(sq_off / n_mae, 3) if n_mae else None
    mae_on = round(sq_on / n_mae, 3) if n_mae else None

    a5 = _t5(actual, PATH_OFFSETS)
    p5_off = _t5(path_off, PATH_OFFSETS)
    p5_on = _t5(path_on, PATH_OFFSETS)
    hit_off = _direction_hit(p5_off, a5) if a5 is not None and p5_off is not None else None
    hit_on = _direction_hit(p5_on, a5) if a5 is not None and p5_on is not None else None

    delta_rmse = round(rmse_on - rmse_off, 3)
    winner = "tie"
    if delta_rmse < -0.05:
        winner = "on"
    elif delta_rmse > 0.05:
        winner = "off"

    return {
        "key": key,
        "ticker": ticker.upper(),
        "cd": cd_iso,
        "source": source,
        "proxy_raw": proxy_raw,
        "n_nodes": min(n_off, n_on),
        "rmse_off_pp": rmse_off,
        "rmse_on_pp": rmse_on,
        "delta_rmse_pp": delta_rmse,
        "mae_off_pp": mae_off,
        "mae_on_pp": mae_on,
        "delta_mae_pp": round((mae_on or 0) - (mae_off or 0), 3) if mae_off is not None and mae_on is not None else None,
        "hit_off": hit_off,
        "hit_on": hit_on,
        "winner": winner,
    }


def _chart_actual_lookup(charts: dict | None) -> dict[str, list[float | None]]:
    out: dict[str, list[float | None]] = {}
    if not isinstance(charts, dict):
        return out
    for sid, ser in (charts.get("series") or {}).items():
        if not str(sid).startswith("co:"):
            continue
        key_tail = str(sid)[3:].upper()
        pts = [p for p in (ser.get("points") or []) if _is_standard_point(p)]
        by_off = {
            int(p["offset"]): _num(p.get("pct_reale"))
            for p in pts
            if p.get("offset") is not None and _num(p.get("pct_reale")) is not None
        }
        if by_off:
            out[key_tail] = [by_off.get(off) for off in PATH_OFFSETS]
    return out


def _events_from_charts(charts: dict, *, past_only: bool, today: date) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for sid, ser in (charts.get("series") or {}).items():
        if not str(sid).startswith("co:"):
            continue
        key_tail = str(sid)[3:]
        if "|" not in key_tail:
            continue
        ticker, cd_iso = key_tail.split("|", 1)
        cd = _parse_cd(cd_iso)
        if past_only and (cd is None or cd >= today):
            continue
        pts = [p for p in (ser.get("points") or []) if _is_standard_point(p)]
        actual_map = {
            int(p["offset"]): _num(p.get("pct_reale"))
            for p in pts
            if p.get("offset") is not None and _num(p.get("pct_reale")) is not None
        }
        if len(actual_map) < 3:
            continue
        path_off, path_on, actual = [], [], []
        for off in PATH_OFFSETS:
            pt = next((p for p in pts if p.get("offset") == off), None)
            path_off.append(_num(pt.get("pct_modello_raw")) if pt else None)
            path_on.append(_num(pt.get("pct_modello")) if pt else None)
            actual.append(actual_map.get(off))
        if not any(x is not None for x in path_off) or not any(x is not None for x in path_on):
            continue
        ev = _compare_paths(
            _event_key(ticker, cd_iso),
            ticker,
            cd_iso,
            path_off,
            path_on,
            actual,
            source="charts",
            proxy_raw=False,
        )
        if ev:
            out.append(ev)
    return out


def _events_from_rows(
    rows: dict[str, dict],
    *,
    source: str,
    past_only: bool,
    today: date,
    chart_actuals: dict[str, list[float | None]] | None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for key, row in rows.items():
        if not isinstance(row, dict):
            continue
        cd_raw = row.get("completion_date") or (str(key).split("|")[-1] if "|" in str(key) else None)
        cd = _parse_cd(str(cd_raw) if cd_raw else None)
        if past_only and (cd is None or cd >= today):
            continue
        ticker = str(row.get("ticker") or str(key).split("|")[0]).strip().upper()
        if not ticker:
            continue
        cd_iso = cd.isoformat() if cd else str(cd_raw)[:10]
        actual = _actual_path_from_rec(row, PATH_OFFSETS)
        if not any(a is not None for a in actual) and chart_actuals:
            actual = chart_actuals.get(_event_key(ticker, cd_iso), [None] * len(PATH_OFFSETS))
        if not any(a is not None for a in actual):
            continue
        if not any(v is not None for v in horizons_off(row).values()):
            continue
        proxy = not has_fit_horizons(row)
        use_stored_on = source == "live" and has_fit_horizons(row)
        path_off = _path_from_interp(row, PATH_OFFSETS, blended=False)
        path_on = _path_from_interp(row, PATH_OFFSETS, blended=True, use_stored_on=use_stored_on)
        ev = _compare_paths(
            _event_key(ticker, cd_iso),
            ticker,
            cd_iso,
            path_off,
            path_on,
            actual,
            source=source,
            proxy_raw=proxy,
        )
        if ev:
            out.append(ev)
    return out


def _dedupe_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rank = {"charts": 0, "live": 1, "past": 2}
    best: dict[str, dict[str, Any]] = {}
    for ev in events:
        k = ev["key"]
        if k not in best or rank.get(ev["source"], 9) < rank.get(best[k]["source"], 9):
            best[k] = ev
    return sorted(best.values(), key=lambda e: (e["cd"], e["ticker"]))
