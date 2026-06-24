"""
Pre-CD live signal audit + calibration for Model Analysis «Pre-CD signals» tab.

- Append-only log: data/signal_audit_log.jsonl (one row per ticker per refresh)
- Summary: data/signal_calibration.json (weekly learning curve, scatter, stratified hit%)
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
SIGNAL_LOG_PATH = _ROOT / "data" / "signal_audit_log.jsonl"
SIGNAL_CALIB_PATH = _ROOT / "data" / "signal_calibration.json"

USEFUL_AFFID_MIN = 50
USEFUL_PRED5_ABS = 2.0
STRONG_PRED5_ABS = 3.0
OUTCOME_HORIZON_BD = 5


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def is_actionable_signal(
    direction: str | None,
    affid: int | float | None,
    pred5_pp: float | None,
) -> bool:
    d = str(direction or "").lower()
    if d not in ("up", "down"):
        return False
    try:
        aff = float(affid or 0)
    except (TypeError, ValueError):
        aff = 0.0
    if aff < USEFUL_AFFID_MIN:
        return False
    try:
        p5 = abs(float(pred5_pp or 0))
    except (TypeError, ValueError):
        return False
    return p5 >= USEFUL_PRED5_ABS


def is_strong_signal(
    direction: str | None,
    affid: int | float | None,
    pred5_pp: float | None,
) -> bool:
    if not is_actionable_signal(direction, affid, pred5_pp):
        return False
    try:
        return abs(float(pred5_pp or 0)) >= STRONG_PRED5_ABS
    except (TypeError, ValueError):
        return False


def _direction_hit(direction: str, actual_pct: float) -> bool | None:
    d = str(direction).lower()
    if d == "up":
        return actual_pct > 0
    if d == "down":
        return actual_pct < 0
    return None


def append_refresh_batch(
  entries: list[dict[str, Any]],
  *,
  log_path: Path | None = None,
) -> int:
    """Append signal rows; skip duplicate ticker+date (same calendar day)."""
    p = Path(log_path or SIGNAL_LOG_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    today_key = date.today().isoformat()
    existing_keys: set[str] = set()
    if p.is_file():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                tk = str(row.get("ticker") or "").upper()
                dk = str(row.get("log_date") or row.get("ts", ""))[:10]
                if tk and dk:
                    existing_keys.add(f"{tk}|{dk}")
            except json.JSONDecodeError:
                continue
    written = 0
    with p.open("a", encoding="utf-8") as fh:
        for e in entries:
            tk = str(e.get("ticker") or "").upper()
            if not tk:
                continue
            key = f"{tk}|{today_key}"
            if key in existing_keys:
                continue
            row = {
                "ts": _utc_now_iso(),
                "log_date": today_key,
                **e,
            }
            fh.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
            existing_keys.add(key)
            written += 1
    return written


def load_log_rows(*, log_path: Path | None = None) -> list[dict[str, Any]]:
    p = Path(log_path or SIGNAL_LOG_PATH)
    if not p.is_file():
        return []
    out: list[dict[str, Any]] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _parse_iso_date(s: str | None) -> date | None:
    if not s:
        return None
    s = str(s).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def _pct_change(p0: float, p1: float) -> float:
    if p0 <= 0:
        return 0.0
    return round((p1 / p0 - 1.0) * 100.0, 2)


def _close_on_or_after(bars: list[tuple[date, float]], start: date, offset_bd: int) -> float | None:
    """Price at start (last bar <= start) and at +offset_bd trading bars after start."""
    if not bars:
        return None
    bars = sorted(bars, key=lambda x: x[0])
    p0 = None
    for d, c in bars:
        if d <= start:
            p0 = c
        else:
            break
    if p0 is None:
        p0 = bars[0][1]
    idx0 = next((i for i, (d, _) in enumerate(bars) if d >= start), len(bars) - 1)
    idx1 = min(len(bars) - 1, idx0 + offset_bd)
    return _pct_change(p0, bars[idx1][1])


def _yf_bars(ticker: str, start: date, end: date) -> list[tuple[date, float]]:
    try:
        import yfinance as yf
    except ImportError:
        return []
    try:
        raw = yf.download(
            ticker,
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            auto_adjust=True,
            progress=False,
        )
        if raw is None or getattr(raw, "empty", True):
            return []
        col = raw["Close"] if "Close" in raw.columns else raw.iloc[:, 0]
        out: list[tuple[date, float]] = []
        for idx, val in col.dropna().items():
            d = idx.date() if hasattr(idx, "date") else _parse_iso_date(str(idx))
            if d:
                out.append((d, float(val)))
        return out
    except Exception:
        return []


def _audit_bars_by_ticker(rows: list[dict[str, Any]]) -> dict[str, list[tuple[date, float]]]:
    """Daily close series from refresh audit log (price_t0 per log_date)."""
    by_day: dict[str, dict[date, float]] = defaultdict(dict)
    for row in rows:
        tk = str(row.get("ticker") or "").upper()
        log_d = _parse_iso_date(str(row.get("log_date") or row.get("ts", ""))[:10])
        price = row.get("price_t0")
        if not tk or not log_d or price is None:
            continue
        try:
            px = float(price)
        except (TypeError, ValueError):
            continue
        if px > 0:
            by_day[tk][log_d] = px
    return {tk: sorted(dmap.items(), key=lambda x: x[0]) for tk, dmap in by_day.items()}


def _resolve_outcome_bars(
    ticker: str,
    log_d: date,
    today: date,
    audit_bars: dict[str, list[tuple[date, float]]],
    yf_cache: dict[str, list[tuple[date, float]]],
) -> list[tuple[date, float]]:
    """Prefer audit-log prices (from live refreshes); fall back to Yahoo."""
    bars = audit_bars.get(ticker) or []
    if len(bars) >= OUTCOME_HORIZON_BD + 2:
        return bars
    if ticker not in yf_cache:
        yf_cache[ticker] = _yf_bars(ticker, log_d - timedelta(days=10), today + timedelta(days=5))
    return yf_cache[ticker]


def close_pending_outcomes(
    rows: list[dict[str, Any]] | None = None,
    *,
    today: date | None = None,
    min_days_since_log: int = 6,
) -> int:
    """Fill actual_5d_pct / hit for log rows old enough to observe +5 sessions."""
    today = today or date.today()
    rows = rows if rows is not None else load_log_rows()
    audit_bars = _audit_bars_by_ticker(rows)
    yf_cache: dict[str, list[tuple[date, float]]] = {}
    closed = 0
    for row in rows:
        if row.get("actual_5d_pct") is not None:
            continue
        log_d = _parse_iso_date(str(row.get("log_date") or row.get("ts", ""))[:10])
        if not log_d or (today - log_d).days < min_days_since_log:
            continue
        ticker = str(row.get("ticker") or "").upper()
        if not ticker:
            continue
        bars = _resolve_outcome_bars(ticker, log_d, today, audit_bars, yf_cache)
        if len(bars) < OUTCOME_HORIZON_BD + 2:
            continue
        actual = _close_on_or_after(bars, log_d, OUTCOME_HORIZON_BD)
        if actual is None:
            continue
        direction = str(row.get("direction") or "")
        hit = _direction_hit(direction, actual)
        row["actual_5d_pct"] = actual
        row["hit"] = hit
        row["closed_at"] = _utc_now_iso()
        ab = audit_bars.get(ticker) or []
        row["outcome_source"] = "audit_log" if len(ab) >= OUTCOME_HORIZON_BD + 2 else "yfinance"
        closed += 1
    if closed:
        _rewrite_log(rows)
    return closed


def _rewrite_log(rows: list[dict[str, Any]], *, log_path: Path | None = None) -> None:
    p = Path(log_path or SIGNAL_LOG_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")


def _iso_week_key(d: date) -> str:
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _cohort_stats(records: list[dict[str, Any]]) -> dict[str, Any]:
    dir_rows = [
        r
        for r in records
        if str(r.get("direction") or "").lower() in ("up", "down")
        and r.get("hit") is not None
    ]
    hits = sum(1 for r in dir_rows if r.get("hit") is True)
    n = len(dir_rows)
    pred_vals = [float(r["pred5_pp"]) for r in dir_rows if r.get("pred5_pp") is not None]
    act_vals = [float(r["actual_5d_pct"]) for r in dir_rows if r.get("actual_5d_pct") is not None]
    return {
        "n": n,
        "hits": hits,
        "hit_pct": round(100.0 * hits / n, 1) if n else None,
        "avg_pred5": round(sum(pred_vals) / len(pred_vals), 2) if pred_vals else None,
        "avg_actual_5d": round(sum(act_vals) / len(act_vals), 2) if act_vals else None,
    }


def build_calibration_document(
    *,
    close_outcomes_first: bool = True,
    log_path: Path | None = None,
    out_path: Path | None = None,
) -> dict[str, Any]:
    rows = load_log_rows(log_path=log_path)
    if close_outcomes_first:
        close_pending_outcomes(rows)
        rows = load_log_rows(log_path=log_path)

    with_outcome = [r for r in rows if r.get("actual_5d_pct") is not None and r.get("hit") is not None]
    actionable_closed = [r for r in with_outcome if r.get("signal_emitted")]
    raw_closed = [
        r
        for r in with_outcome
        if str(r.get("direction") or "").lower() in ("up", "down")
    ]
    useful_closed = [r for r in actionable_closed if is_actionable_signal(
        r.get("direction"), r.get("affid"), r.get("pred5_pp")
    )]
    strong_closed = [r for r in actionable_closed if is_strong_signal(
        r.get("direction"), r.get("affid"), r.get("pred5_pp")
    )]

    week_map: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in actionable_closed:
        ld = _parse_iso_date(str(r.get("log_date") or r.get("ts", ""))[:10])
        if ld:
            week_map[_iso_week_key(ld)].append(r)

    weekly: list[dict[str, Any]] = []
    for wk in sorted(week_map.keys()):
        st = _cohort_stats(week_map[wk])
        weekly.append({"week_key": wk, **st})

    scatter = [
        {
            "ticker": r.get("ticker"),
            "pred5_pp": r.get("pred5_pp"),
            "actual_5d_pct": r.get("actual_5d_pct"),
            "hit": r.get("hit"),
            "affid": r.get("affid"),
            "log_date": r.get("log_date"),
        }
        for r in actionable_closed
        if r.get("pred5_pp") is not None and r.get("actual_5d_pct") is not None
    ]

    live_pending = [
        r
        for r in rows
        if r.get("actual_5d_pct") is None
        and is_actionable_signal(r.get("direction"), r.get("affid"), r.get("pred5_pp"))
    ]
    # Latest row per ticker for live dashboard
    latest_by_ticker: dict[str, dict[str, Any]] = {}
    for r in sorted(rows, key=lambda x: str(x.get("ts") or "")):
        tk = str(r.get("ticker") or "").upper()
        if tk:
            latest_by_ticker[tk] = r

    doc: dict[str, Any] = {
        "generated_at": _utc_now_iso(),
        "schema_version": 1,
        "log_rows": len(rows),
        "closed_rows": len(with_outcome),
        "filters": {
            "useful": {"affid_min": USEFUL_AFFID_MIN, "pred5_abs_min": USEFUL_PRED5_ABS},
            "strong": {"affid_min": USEFUL_AFFID_MIN, "pred5_abs_min": STRONG_PRED5_ABS},
        },
        "cohorts": {
            "raw": _cohort_stats(raw_closed),
            "useful": _cohort_stats(useful_closed),
            "strong": _cohort_stats(strong_closed),
        },
        "weekly_actionable": weekly,
        "scatter_pred5_vs_actual": scatter,
        "live_latest": list(latest_by_ticker.values()),
        "pending_outcomes": len(live_pending),
    }

    try:
        from prediction.pre_cd_curve_impact import build_curve_impact_cumulative

        doc["curve_impact_cumulative"] = build_curve_impact_cumulative()
    except Exception as exc:
        doc["curve_impact_cumulative"] = {"n_events": 0, "error": str(exc)}

    try:
        from prediction.eis_magnitude_analysis import persist_eis_magnitude_analysis

        mag = (doc.get("curve_impact_cumulative") or {}).get("eis_magnitude_analysis")
        if isinstance(mag, dict) and (mag.get("n_events_scored") or 0) > 0:
            persist_eis_magnitude_analysis(mag)
    except Exception:
        pass

    op = Path(out_path or SIGNAL_CALIB_PATH)
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(doc, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return doc


def entries_from_live_metrics(
    metrics: dict[str, dict[str, Any]],
    *,
    cd_by_ticker: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Build audit rows from refresh_live_signals metrics dict."""
    out: list[dict[str, Any]] = []
    cds = cd_by_ticker or {}
    for ticker, m in metrics.items():
        tk = str(ticker).upper()
        direction = str(m.get("direction_live") or "neutral")
        try:
            pred5 = float(m.get("pred5_live") or 0)
        except (TypeError, ValueError):
            pred5 = 0.0
        try:
            affid = int(m.get("affid_live") or 0)
        except (TypeError, ValueError):
            affid = 0
        emitted = is_actionable_signal(direction, affid, pred5)
        out.append({
            "ticker": tk,
            "cd_date": cds.get(tk) or m.get("cd_date"),
            "days_to_cd": m.get("days_to_cd"),
            "direction": direction,
            "pred5_pp": pred5,
            "affid": affid,
            "price_t0": m.get("current_price"),
            "signal_emitted": emitted,
            "signal_tier": (
                "strong" if is_strong_signal(direction, affid, pred5)
                else "useful" if emitted
                else "raw"
            ),
        })
    return out


def load_calibration(path: Path | None = None) -> dict[str, Any]:
    p = Path(path or SIGNAL_CALIB_PATH)
    if not p.is_file():
        return {"schema_version": 1, "cohorts": {}, "weekly_actionable": [], "scatter_pred5_vs_actual": []}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"schema_version": 1, "error": "read_failed"}
