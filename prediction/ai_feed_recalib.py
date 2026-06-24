"""
AI Feed (clinical pre-CD enrichment) → sequential curve recalibration knots.

Uses publication-day closes T, T+1, T+3 (first three sessions on/after event_date)
as % vs T−60, mapped to ``SIMULATION_PRED_CAL_OFFSETS`` — only where ``act[i]`` is
still empty (no duplicate of calendar close or SEC 8-K merge).

Snapshot: ``data/clinical_pre_cd_enrichment_snapshot.json``
"""
from __future__ import annotations

import json
import pathlib
from datetime import date, timedelta
from typing import Any

from prediction.config import get_config, pred_ai_feed_seq_merge_enabled

try:
    from clinical_pre_cd_enrichment import verify_event_reference
except ImportError:
    verify_event_reference = None  # type: ignore[misc, assignment]

_SNAPSHOT = pathlib.Path("data") / "clinical_pre_cd_enrichment_snapshot.json"
_INDEX: dict[str, dict[str, Any]] | None = None


def _parse_date(raw: Any) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, date):
        return raw
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def load_ai_feed_snapshot(path: pathlib.Path | str | None = None) -> dict[str, Any]:
    p = pathlib.Path(path or _SNAPSHOT)
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def build_ai_feed_index(snap: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    """``TICKER|YYYY-MM-DD`` → enrichment record."""
    doc = snap if snap is not None else load_ai_feed_snapshot()
    out: dict[str, dict[str, Any]] = {}
    for rec in doc.get("records") or []:
        if not isinstance(rec, dict):
            continue
        tk = str(rec.get("ticker") or "").strip().upper()
        cd = _parse_date(rec.get("cd_date"))
        if not tk or cd is None:
            continue
        out[f"{tk}|{cd.isoformat()}"] = rec
    return out


def get_ai_feed_index(*, reload: bool = False) -> dict[str, dict[str, Any]]:
    global _INDEX
    if _INDEX is None or reload:
        _INDEX = build_ai_feed_index()
    return _INDEX


def _drug_tokens_from_record(rec: dict[str, Any] | None) -> list[str]:
    if not rec:
        return []
    ctx = rec.get("publication_context")
    if isinstance(ctx, dict):
        raw = ctx.get("drug_tokens_searched") or []
        return [str(x) for x in raw if x]
    return []


def is_event_reference_verified(
    ev: dict[str, Any],
    rec: dict[str, Any] | None,
) -> tuple[bool, str | None]:
    """Allineato al bollino verde del pannello AI feed."""
    if ev.get("reference_verified") is True:
        return True, ev.get("reference_match") if ev.get("reference_match") else "stored"
    if ev.get("reference_verified") is False:
        return False, ev.get("reference_match")
    if verify_event_reference is None or not rec:
        return False, None
    return verify_event_reference(
        ev,
        company=str(rec.get("company") or ""),
        ticker=str(rec.get("ticker") or ""),
        drug_tokens=_drug_tokens_from_record(rec),
    )


def events_for_ticker_cd(
    ticker: str,
    cd: date,
    *,
    index: dict[str, dict[str, Any]] | None = None,
    verified_only: bool = False,
) -> list[dict[str, Any]]:
    idx = index if index is not None else get_ai_feed_index()
    key = f"{str(ticker).strip().upper()}|{cd.isoformat()}"
    rec = idx.get(key)
    if not rec:
        return []
    events = rec.get("clinical_events") or rec.get("timeline_events") or []
    ws = _parse_date(rec.get("window_start"))
    we = _parse_date(rec.get("window_end"))
    out: list[dict[str, Any]] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        if str(ev.get("source_type") or "").lower() == "sec_8k":
            continue
        ed = _parse_date(ev.get("event_date"))
        if ed is None:
            continue
        if ws and we and not (ws <= ed <= we):
            continue
        if verified_only:
            ok, _match = is_event_reference_verified(ev, rec)
            if not ok:
                continue
        out.append(ev)
    return out


def publication_sessions_pct_vs_p60(
    close_series,
    *,
    event_d: date,
    p60: float,
    today: date,
    sessions_after_event: bool = False,
) -> list[tuple[date, float]]:
    """
    Three trading sessions → (trade_date, % vs p60).

    ``sessions_after_event=False`` (default): on/after ``event_d`` (legacy).
    ``sessions_after_event=True``: strictly after ``event_d`` (+1/+2/+3), aligned with K-8 post-filing.
    """
    if close_series is None or getattr(close_series, "empty", True):
        return []
    if p60 <= 0 or event_d is None:
        return []
    try:
        import pandas as pd
    except ImportError:
        return []

    out: list[tuple[date, float]] = []
    for ix in sorted(close_series.index):
        try:
            td = pd.Timestamp(ix).normalize().date()
        except Exception:
            continue
        if sessions_after_event:
            if td <= event_d:
                continue
        elif td < event_d:
            continue
        if today < td:
            continue
        try:
            px = float(close_series.loc[ix])
        except (TypeError, ValueError, KeyError):
            continue
        if px <= 0:
            continue
        pct = round((px / float(p60) - 1.0) * 100.0, 4)
        out.append((td, pct))
        if len(out) >= 3:
            break
    return out


def event_prediction_score(ev: dict[str, Any]) -> float | None:
    """
  Score for polynomial shift: EIS market reaction when present, else AI sentiment
  scaled to EIS-like units (sentiment ∈ [-2,2] → ×5).
    """
    import math

    eis = ev.get("eis")
    if isinstance(eis, dict):
        try:
            score = float(eis.get("score"))
            if math.isfinite(score):
                return score
        except (TypeError, ValueError):
            pass
    try:
        sent = float(ev.get("sentiment", 0))
    except (TypeError, ValueError):
        sent = 0.0
    sent = max(-2.0, min(2.0, sent))
    if abs(sent) < 0.05:
        return None
    return round(sent * 5.0, 3)


def _event_kpi_quality_weight(ev: dict[str, Any]) -> float:
    """Quality multiplier [0.5, 2.0] based on KPI data richness in the event.

    Events with strong clinical KPI data (p-value, endpoint met, high data maturity)
    get higher weight in EIS aggregation than events with only sentiment/price data.
    """
    import math

    eis = ev.get("eis")
    kpi_score = None
    if isinstance(eis, dict):
        try:
            kpi_score = float(eis["kpi_score"]) if eis.get("kpi_score") is not None else None
        except (TypeError, ValueError):
            kpi_score = None

    if kpi_score is not None and math.isfinite(kpi_score):
        # kpi_score ∈ [-2, +2] → quality weight [0.5, 2.0]
        # Negative score lowers confidence weight; positive score raises it.
        quality = 1.0 + kpi_score * 0.25
        return max(0.5, min(2.0, quality))

    # Fallback: count indicator fields present as a proxy for data richness
    indicators = ev.get("indicators") or []
    rich = sum(
        1
        for ind in indicators[:6]
        if isinstance(ind, dict) and (
            ind.get("p_value") or ind.get("confidence_interval") or ind.get("data_maturity")
        )
    )
    if rich >= 3:
        return 1.5
    if rich >= 1:
        return 1.2
    return 1.0


def aggregate_eis_for_events(
    events: list[dict[str, Any]],
    *,
    today: date,
    cd: date | None = None,
    half_life_days: float = 21.0,
) -> float | None:
    """
    Recency × KPI-quality weighted mean EIS from Catalyst Feed clinical events.

    Events with rich KPI data (p-value, CI, endpoint met) receive higher weight
    than events with only price reaction or sentiment heuristics.
    """
    if not events:
        return None
    import math

    num = 0.0
    den = 0.0
    for ev in events:
        score = event_prediction_score(ev)
        if score is None or not math.isfinite(score):
            continue
        ed = _parse_date(ev.get("event_date"))
        if ed is None:
            recency_w = 1.0
        else:
            age = max(0, (today - ed).days)
            recency_w = math.exp(-age / max(1.0, half_life_days))
        quality_w = _event_kpi_quality_weight(ev)
        w = recency_w * quality_w
        num += score * w
        den += w
    if den <= 0:
        return None
    return round(num / den, 3)


_KPI_TYPE_WEIGHT_RECALIB: dict[str, float] = {
    "efficacy": 1.0,
    "regulatory": 0.9,
    "biomarker": 0.6,
    "safety": 0.5,
    "enrollment": 0.2,
    "other": 0.3,
}

_DATA_MATURITY_BONUS_RECALIB: dict[str, float] = {
    "final": 0.30,
    "primary": 0.15,
    "interim": 0.00,
    "not_reported": -0.10,
}


def _parse_pvalue_recalib(text: str) -> float | None:
    import re
    m = re.search(r"\d+\.\d+", text or "")
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            pass
    return None


def _indicator_unit_score(ind: dict[str, Any]) -> float:
    """Signed contribution from one verified clinical KPI row.

    Uses all enriched fields: p_value, data_maturity, vs_soc, kpi_type, CI.
    """
    if not isinstance(ind, dict):
        return 0.0
    s = 0.0

    # Endpoint met / missed (primary signal)
    ep = ind.get("endpoint_met")
    if ep is True:
        s += 1.0
    elif ep is False:
        s -= 1.0
    else:
        d = str(ind.get("direction") or "").strip().lower()
        if d == "up":
            s += 0.35
        elif d == "down":
            s -= 0.35

    # p-value strength
    p = _parse_pvalue_recalib(str(ind.get("p_value") or ""))
    if p is not None:
        if p < 0.001:
            s += 0.60
        elif p < 0.01:
            s += 0.40
        elif p < 0.05:
            s += 0.20
        else:
            s -= 0.20  # reported but not significant

    # Data maturity (how definitive the data is)
    dm = str(ind.get("data_maturity") or "not_reported").lower()
    s += _DATA_MATURITY_BONUS_RECALIB.get(dm, 0.0)

    # SOC comparison present → stronger signal
    vs_soc = str(ind.get("vs_soc") or "")
    if vs_soc and vs_soc.lower() not in ("null", "n/d", ""):
        s += 0.20

    # CI present → data quality bonus
    ci = str(ind.get("confidence_interval") or "")
    if ci and ci.lower() not in ("null", "n/d", ""):
        s += 0.10

    # Numeric value bonus for high/low efficacy endpoints
    try:
        nv = ind.get("numeric_value")
        if nv is not None and nv == nv:
            n = float(nv)
            lab = str(ind.get("label") or "").lower()
            if any(k in lab for k in ("orr", "response", "pfs", "os", "survival", "efficacy")):
                if n >= 50:
                    s += 0.25
                elif n <= 10 and "orr" in lab:
                    s -= 0.20
    except (TypeError, ValueError):
        pass

    # Scale by KPI type importance
    kpi_type = str(ind.get("kpi_type") or "other").lower()
    type_w = _KPI_TYPE_WEIGHT_RECALIB.get(kpi_type, 0.3)
    s *= type_w

    return s


def aggregate_clinical_indicator_shift_pp(
    record: dict[str, Any] | None,
    events: list[dict[str, Any]],
    *,
    today: date,
    half_life_days: float = 21.0,
) -> tuple[float, int]:
    """
    Recency-weighted KPI signal from ``clinical_indicators`` + per-event ``indicators``.
    Returns (shift_pp, n_kpi_rows_used).
    """
    cfg = get_config()
    if not cfg.pred_clinical_indicators_poly:
        return 0.0, 0

    import math

    scored: list[tuple[date | None, float]] = []
    seen_keys: set[tuple[str, str, str]] = set()

    def _collect(ind: dict[str, Any], ed: date | None) -> None:
        k_date = ed.isoformat() if ed else ""
        k_label = str(ind.get("label") or "").strip().lower()
        k_ep = str(ind.get("endpoint_met")).strip().lower()
        dedupe_key = (k_date, k_label, k_ep)
        if dedupe_key in seen_keys:
            return
        seen_keys.add(dedupe_key)
        unit = _indicator_unit_score(ind)
        if abs(unit) < 1e-6:
            return
        scored.append((ed, unit))

    for ind in (record or {}).get("clinical_indicators") or []:
        if isinstance(ind, dict):
            _collect(ind, _parse_date(ind.get("indicator_date")))

    for ev in events:
        ed = _parse_date(ev.get("event_date"))
        for ind in ev.get("indicators") or []:
            if isinstance(ind, dict):
                _collect(ind, ed)

    if not scored:
        return 0.0, 0

    num = 0.0
    den = 0.0
    for ed, unit in scored:
        if ed is None:
            w = 1.0
        else:
            age = max(0, (today - ed).days)
            w = math.exp(-age / max(1.0, half_life_days))
        num += unit * w
        den += w
    if den <= 0:
        return 0.0, 0

    mean = num / den
    raw_pp = mean * cfg.pred_clinical_indicators_alpha
    cap = cfg.pred_clinical_indicators_max_pp
    if raw_pp > cap:
        raw_pp = cap
    elif raw_pp < -cap:
        raw_pp = -cap
    return round(raw_pp, 3), len(scored)


def events_for_prediction(
    ticker: str,
    cd: date,
    *,
    index: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Catalyst Feed events for the precat polynomial (verified-only if configured)."""
    verified = get_config().pred_ai_feed_verified_only
    return events_for_ticker_cd(ticker, cd, index=index, verified_only=verified)


def build_prediction_clinical_signal(
    ticker: str,
    cd: date,
    *,
    today: date,
    index: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Bundle EIS + verified KPI shift for ``_compute_price_predictions`` polynomial path.
    """
    idx = index if index is not None else get_ai_feed_index()
    key = f"{str(ticker).strip().upper()}|{cd.isoformat()}"
    rec = idx.get(key)
    events = events_for_prediction(ticker, cd, index=idx)
    eis_agg = aggregate_eis_for_events(events, today=today, cd=cd)
    ind_pp, n_kpi = aggregate_clinical_indicator_shift_pp(rec, events, today=today)
    return {
        "record": rec,
        "events": events,
        "eis_agg": eis_agg,
        "indicator_shift_pp": ind_pp,
        "indicator_kpi_n": n_kpi,
        "verified_only": get_config().pred_ai_feed_verified_only,
        "verified_events_n": len(events),
    }


def _ai_feed_sessions_for_event(
    ev: dict[str, Any],
    *,
    close_series,
    p60: float,
    today: date,
) -> list[tuple[date, float, int]]:
    """
    (trade_date, pct_vs_p60, session_index 1..3) for one publication event.
    Falls back to stored T+1/T+3 prices when close series is missing.
    """
    ed = _parse_date(ev.get("event_date"))
    if ed is None or p60 <= 0:
        return []
    sessions = publication_sessions_pct_vs_p60(
        close_series,
        event_d=ed,
        p60=float(p60),
        today=today,
    )
    if sessions:
        return [(td, pct, i + 1) for i, (td, pct) in enumerate(sessions)]
    price = ev.get("price") if isinstance(ev.get("price"), dict) else {}
    out: list[tuple[date, float, int]] = []
    for sess_i, (td_approx, px) in (
        (1, price.get("p_t1")),
        (3, price.get("p_t3")),
    ):
        if px is None:
            continue
        try:
            fp = float(px)
        except (TypeError, ValueError):
            continue
        if fp <= 0:
            continue
        td = ed if sess_i == 1 else ed + timedelta(days=3)
        if today < td:
            continue
        pct = round((fp / float(p60) - 1.0) * 100.0, 4)
        out.append((td, pct, sess_i))
    return out


def merge_ai_feed_observations_into_act(
    *,
    tk: str,
    cd: date,
    p60: float,
    today: date,
    offsets: tuple[int, ...],
    act: list,
    close_series,
    index: dict[str, dict[str, Any]] | None = None,
    snap_cal_day_to_offset_index,
    max_slack_days: int = 7,
    filled_offset_indices: list[int] | None = None,
) -> int:
    """
    Fill ``act[i]`` from AI feed publication sessions (T…T+3) where still empty.
    Never overwrites nodes already set by market close or 8-K merge.
    Dedupes by trade date per offset bucket (no double count same session date).
    Uses only events with verified reference (same rule as chart markers).
    """
    if filled_offset_indices is not None:
        filled_offset_indices.clear()
    if not pred_ai_feed_seq_merge_enabled():
        return 0
    if not act or p60 <= 0:
        return 0

    events = events_for_ticker_cd(tk, cd, index=index, verified_only=True)
    if not events:
        return 0

    n = len(offsets)
    buckets: dict[int, list[float]] = {}
    seen_trade_by_idx: dict[int, set[str]] = {}

    def _try_add(idx: int, trade_d: date, pct: float) -> None:
        if idx < 0 or idx >= n:
            return
        if today < cd + timedelta(days=int(offsets[idx])):
            return
        if act[idx] is not None:
            return
        td_key = trade_d.isoformat()
        seen = seen_trade_by_idx.setdefault(idx, set())
        if td_key in seen:
            return
        seen.add(td_key)
        buckets.setdefault(idx, []).append(float(pct))

    for ev in events:
        for td_s, pct, _sess in _ai_feed_sessions_for_event(
            ev, close_series=close_series, p60=float(p60), today=today
        ):
            try:
                off_cal = (td_s - cd).days
            except Exception:
                continue
            idx = snap_cal_day_to_offset_index(
                int(off_cal), offsets, max_slack_days=max_slack_days
            )
            if idx is None:
                continue
            _try_add(int(idx), td_s, pct)

    filled = 0
    for idx, vals in buckets.items():
        if not vals or act[idx] is not None:
            continue
        try:
            act[idx] = round(sum(vals) / float(len(vals)), 4)
            filled += 1
            if filled_offset_indices is not None:
                filled_offset_indices.append(int(idx))
        except Exception:
            continue
    return filled


def ai_feed_chart_points(
    *,
    tk: str,
    cd: date,
    p60: float,
    today: date,
    close_series,
    index: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """
    Scatter points for charts: +1 / +2 / +3 trading sessions after publication (deduped).
    Only events with verified reference (green badge in AI feed table).
    """
    events = events_for_ticker_cd(tk, cd, index=index, verified_only=True)
    if not events or p60 <= 0:
        return []
    seen_trade: set[str] = set()
    out: list[dict[str, Any]] = []
    for ev in events:
        ed = _parse_date(ev.get("event_date"))
        if ed is None:
            continue
        _ok, ref_match = is_event_reference_verified(
            ev, (index or get_ai_feed_index()).get(f"{str(tk).strip().upper()}|{cd.isoformat()}")
        )
        title = str(ev.get("event_title") or "Clinical publication")[:80]
        src = str(ev.get("source_type") or "publication")[:32]
        for td_s, pct, sess in _ai_feed_sessions_for_event(
            ev, close_series=close_series, p60=float(p60), today=today
        ):
            td_key = td_s.isoformat()
            if td_key in seen_trade:
                continue
            seen_trade.add(td_key)
            try:
                off_cal = int((td_s - cd).days)
            except Exception:
                continue
            sess_label = f"+{sess}"
            ed_s = ed.strftime("%d/%m/%Y")
            out.append(
                {
                    "sort": (2, td_s.toordinal(), int(sess)),
                    "offset": off_cal,
                    "nodo": "AI feed",
                    "label": f"Pub {ed_s} {sess_label}",
                    "data_cal": td_s,
                    "data_raw": td_s,
                    "ai_feed_event_date": ed.isoformat(),
                    "ai_feed_session": int(sess),
                    "event_title": title,
                    "source_type": src,
                    "link": ev.get("link"),
                    "reference_verified": True,
                    "reference_match": ref_match,
                    "tipo": "ricalibrata (AI feed · ref. verificata)",
                    "pct_curva": round(float(pct), 4),
                    "pct_reale": round(float(pct), 4),
                    "pct_modello": None,
                }
            )
    out.sort(key=lambda r: r.get("sort", (0, 0)))
    return out


__all__ = [
    "aggregate_clinical_indicator_shift_pp",
    "aggregate_eis_for_events",
    "ai_feed_chart_points",
    "build_ai_feed_index",
    "build_prediction_clinical_signal",
    "event_prediction_score",
    "events_for_prediction",
    "events_for_ticker_cd",
    "get_ai_feed_index",
    "is_event_reference_verified",
    "load_ai_feed_snapshot",
    "merge_ai_feed_observations_into_act",
    "publication_sessions_pct_vs_p60",
]
