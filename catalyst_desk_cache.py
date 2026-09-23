"""
Catalyst desk column cache
==========================
Morning (weekday): Ticker / Event / Days Left + Insider + Exec Exit + FDA Brief
+ G-Trends (once/day snapshot from search_interest disk cache).
Hourly (Nasdaq regular hours): Bias inputs — Vol, Sentiment/Skew, Short Δ, vs XBI,
Pre-Mkt (read-through existing caches; Soft BUY/SELL unchanged).

Display membership only — does **not** change Soft BUY/SELL gates.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("supernova.catalyst_desk_cache")

# Align with desktop SIM_HOT_ZONE_DAYS / Wind + Catalyst.
HOT_ZONE_DAYS = 60

_CACHE_DIR = Path("data") / "cache"
_MORNING_PATH = _CACHE_DIR / "catalyst_desk_morning.json"
_HOURLY_PATH = _CACHE_DIR / "catalyst_desk_hourly.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _rome_date(now: datetime | None = None) -> str:
    ref = now or datetime.now(timezone.utc)
    try:
        from zoneinfo import ZoneInfo

        return ref.astimezone(ZoneInfo("Europe/Rome")).date().isoformat()
    except Exception:
        return date.today().isoformat()


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _write_json(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _parse_iso(raw: Any) -> date | None:
    s = str(raw or "").strip()[:10]
    if len(s) < 10:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _days_until(d: date | None, today: date | None = None) -> int | None:
    if d is None:
        return None
    return (d - (today or date.today())).days


def desk_hot_pairs(*, horizon_days: int = HOT_ZONE_DAYS) -> list[tuple[str, str]]:
    """(ticker, event_date) inside the Catalyst hot zone.

    Union of simulation/snapshot pairs **and** morning identity rows (guidance /
    FDA / sim CD). Otherwise guidance-only names (e.g. ENTA) appear in the table
    but never get Short Δ / Vol / vs XBI / Pre-Mkt.
    """
    out: list[tuple[str, str]] = []
    seen: set[str] = set()

    def _add(tk: Any, iso: Any) -> None:
        t = str(tk or "").strip().upper()
        d = str(iso or "").strip()[:10]
        if not t or len(d) < 10:
            return
        key = f"{t}|{d}"
        if key in seen:
            return
        seen.add(key)
        out.append((t, d))

    try:
        from event_vol_index import upcoming_pairs_from_snapshots

        for tk, iso in upcoming_pairs_from_snapshots(horizon_days):
            _add(tk, iso)
    except Exception as exc:
        logger.warning("desk hot pairs (snapshots) failed: %s", exc)

    try:
        for ev in _build_morning_events():
            _add(ev.get("ticker"), ev.get("event_date"))
    except Exception as exc:
        logger.warning("desk hot pairs (morning events) failed: %s", exc)

    return out

def desk_hot_tickers(*, horizon_days: int = HOT_ZONE_DAYS) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for tk, _ in desk_hot_pairs(horizon_days=horizon_days):
        t = str(tk or "").strip().upper()
        if not t or t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def _build_morning_events(today: date | None = None) -> list[dict[str, Any]]:
    """Identity rows for the first three Catalyst columns (≤ hot zone)."""
    ref = today or date.today()
    end = ref + timedelta(days=HOT_ZONE_DAYS)
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _push(
        ticker: str,
        event_date: str,
        *,
        event_type: str,
        event_name: str,
        company: str = "",
        source: str = "",
    ) -> None:
        tk = ticker.strip().upper()
        iso = event_date[:10]
        d = _parse_iso(iso)
        if not tk or d is None or d < ref or d > end:
            return
        key = f"{tk}|{iso}|{event_type}"
        if key in seen:
            return
        seen.add(key)
        days = _days_until(d, ref)
        rows.append(
            {
                "ticker": tk,
                "event_date": iso,
                "days_until": days,
                "event_type": event_type,
                "event_name": event_name or event_type,
                "company": company,
                "source": source,
            }
        )

    gdoc = _read_json(Path("data") / "guidance_calendar_snapshot.json")
    for ev in (gdoc.get("events") if gdoc else None) or []:
        if not isinstance(ev, dict):
            continue
        iso = str(ev.get("window_start") or ev.get("window_end") or "")[:10]
        _push(
            str(ev.get("ticker") or ""),
            iso,
            event_type=str(ev.get("event_type") or "other"),
            event_name=str(ev.get("asset_name") or ev.get("event_type") or ""),
            company=str(ev.get("company") or ""),
            source="guidance",
        )

    fdoc = _read_json(Path("data") / "fda_adcom_calendar_snapshot.json")
    for row in (fdoc.get("rows") if fdoc else None) or []:
        if not isinstance(row, dict):
            continue
        _push(
            str(row.get("ticker") or ""),
            str(row.get("date") or ""),
            event_type="fda_vote",
            event_name=str(row.get("product") or row.get("eventEn") or "FDA AdCom"),
            company=str(row.get("company") or ""),
            source="fda_adcom",
        )

    try:
        from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

        sdoc = _read_json(Path(SIMULATION_SHEET_SNAPSHOT_JSON))
        for row in (sdoc.get("rows") if sdoc else None) or []:
            if not isinstance(row, dict):
                continue
            raw = str(row.get("Completion Date") or row.get("completion_date") or "")
            iso = raw
            if "/" in raw:
                try:
                    d, m, y = raw.split("/")[:3]
                    iso = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
                except (ValueError, TypeError):
                    continue
            _push(
                str(row.get("Ticker") or row.get("ticker") or ""),
                iso,
                event_type="cd",
                event_name=str(row.get("Drug") or "CD"),
                company=str(row.get("Società") or row.get("Societa") or ""),
                source="simulation",
            )
    except Exception as exc:
        logger.warning("morning events sim scan failed: %s", exc)

    rows.sort(key=lambda r: (int(r.get("days_until") or 9999), str(r.get("ticker") or "")))
    return rows


def _fda_brief_by_ticker() -> dict[str, Any]:
    fdoc = _read_json(Path("data") / "fda_adcom_calendar_snapshot.json")
    out: dict[str, Any] = {}
    for row in (fdoc.get("rows") if fdoc else None) or []:
        if not isinstance(row, dict):
            continue
        tk = str(row.get("ticker") or "").strip().upper()
        if not tk:
            continue
        briefing = row.get("briefing")
        # Keep nearest upcoming row per ticker.
        prev = out.get(tk)
        if prev is None:
            out[tk] = {
                "ticker": tk,
                "date": str(row.get("date") or "")[:10],
                "company": row.get("company"),
                "product": row.get("product"),
                "eventEn": row.get("eventEn"),
                "eventIt": row.get("eventIt"),
                "href": row.get("href"),
                "briefing": briefing,
                "id": row.get("id"),
            }
            continue
        d_new = _parse_iso(row.get("date"))
        d_old = _parse_iso(prev.get("date"))
        if d_new is not None and (d_old is None or d_new < d_old):
            out[tk] = {
                "ticker": tk,
                "date": str(row.get("date") or "")[:10],
                "company": row.get("company"),
                "product": row.get("product"),
                "eventEn": row.get("eventEn"),
                "eventIt": row.get("eventIt"),
                "href": row.get("href"),
                "briefing": briefing,
                "id": row.get("id"),
            }
    return out


def run_morning_desk_cache_refresh(*, force: bool = False) -> dict[str, Any]:
    """Weekday morning: warm Insider/Exec Exit + Trends + identity + FDA Brief."""
    today = date.today()
    events = _build_morning_events(today)
    tickers = sorted({str(e.get("ticker") or "").upper() for e in events if e.get("ticker")})
    accum_rows: dict[str, Any] = {}
    accum_err: str | None = None
    try:
        from catalyst_accumulation import fetch_catalyst_accumulation

        accum = fetch_catalyst_accumulation(tickers, force=force)
        accum_rows = dict(accum.get("rows") or {})
        if accum.get("error"):
            accum_err = str(accum.get("error"))
    except Exception as exc:
        accum_err = str(exc)
        logger.warning("morning desk accumulation failed: %s", exc)

    trends_rows: dict[str, Any] = {}
    trends_err: str | None = None
    try:
        from search_interest import fetch_search_interest

        # Prefer disk prints warmed by the Trends scheduler (2–3×/day) — once/day desk snapshot.
        tr = fetch_search_interest(tickers)
        trends_rows = dict(tr.get("rows") or {})
        if tr.get("error"):
            trends_err = str(tr.get("error"))
    except Exception as exc:
        trends_err = str(exc)
        logger.warning("morning desk trends failed: %s", exc)

    fda_brief = _fda_brief_by_ticker()
    # Restrict FDA brief map to hot-zone tickers when possible.
    if tickers:
        fda_brief = {tk: fda_brief[tk] for tk in tickers if tk in fda_brief}

    err_bits = [x for x in (accum_err, trends_err) if x]
    doc: dict[str, Any] = {
        "updated_at": _now_iso(),
        "rome_date": _rome_date(),
        "horizon_days": HOT_ZONE_DAYS,
        "kind": "morning",
        "events": events,
        "tickers": tickers,
        "accumulation": accum_rows,
        "trends": trends_rows,
        "fda_brief": fda_brief,
        "error": "; ".join(err_bits) if err_bits else None,
    }
    _write_json(_MORNING_PATH, doc)
    logger.info(
        "Catalyst morning cache: events=%s tickers=%s accum=%s trends=%s fda=%s",
        len(events),
        len(tickers),
        len(accum_rows),
        len(trends_rows),
        len(fda_brief),
    )
    return {
        "ok": not err_bits,
        "events": len(events),
        "tickers": len(tickers),
        "accumulation": len(accum_rows),
        "trends": len(trends_rows),
        "fda_brief": len(fda_brief),
        "updated_at": doc["updated_at"],
        "error": doc.get("error"),
    }


def _row_has_signal(row: Any, signal_keys: tuple[str, ...]) -> bool:
    if not isinstance(row, dict):
        return False
    for key in signal_keys:
        val = row.get(key)
        if val is None:
            continue
        if isinstance(val, bool):
            return True
        if isinstance(val, (int, float)) and val == val:  # not NaN
            return True
        if isinstance(val, str):
            s = val.strip()
            if s and s != "—" and s.lower() != "nan":
                return True
            continue
        if isinstance(val, list) and val:
            return True
    return False


def _coalesce_desk_row(
    prev: dict[str, Any],
    nxt: dict[str, Any],
    signal_keys: tuple[str, ...],
) -> dict[str, Any]:
    """Keep prior valid signal fields when a live reprint is null/empty/shell."""
    next_ok = _row_has_signal(nxt, signal_keys)
    prev_ok = _row_has_signal(prev, signal_keys)
    # Empty/shell never replaces prior — and never plants a new empty over empty.
    if not next_ok:
        return prev
    if not prev_ok:
        return nxt
    out = dict(nxt)
    for key in signal_keys:
        nv = out.get(key)
        missing = (
            nv is None
            or (isinstance(nv, float) and nv != nv)
            or (isinstance(nv, str) and (not nv.strip() or nv.strip() == "—" or nv.strip().lower() == "nan"))
        )
        if not missing:
            continue
        pv = prev.get(key)
        if pv is None:
            continue
        if isinstance(pv, float) and pv != pv:
            continue
        if isinstance(pv, str) and (not pv.strip() or pv.strip() == "—" or pv.strip().lower() == "nan"):
            continue
        out[key] = pv
    # Preserve hourly visit Δ when a live reprint omits it (stamped by _attach_hour_price_delta).
    for key in ("hour_chg_pct", "prev_hour_close"):
        if out.get(key) is None and prev.get(key) is not None:
            out[key] = prev.get(key)
    # Keep prior provenance fields when next omits `_desk`.
    prev_desk = prev.get("_desk")
    next_desk = nxt.get("_desk")
    if isinstance(next_desk, dict):
        if isinstance(prev_desk, dict):
            merged_fields = {
                **(prev_desk.get("fields") or {}),
                **(next_desk.get("fields") or {}),
            }
            out["_desk"] = {**prev_desk, **next_desk, "fields": merged_fields}
        else:
            out["_desk"] = next_desk
    elif isinstance(prev_desk, dict):
        out["_desk"] = prev_desk
    return out


def _merge_hourly_column_map(
    prev: dict[str, Any] | None,
    nxt: dict[str, Any] | None,
    signal_keys: tuple[str, ...],
) -> dict[str, Any]:
    left = prev if isinstance(prev, dict) else {}
    right = nxt if isinstance(nxt, dict) else {}
    if not right and left:
        return dict(left)
    if not left:
        return dict(right)
    out = dict(left)
    for raw, row in right.items():
        tk = str(raw or "").strip().upper()
        if not tk or not isinstance(row, dict):
            continue
        old = out.get(tk)
        if isinstance(old, dict):
            out[tk] = _coalesce_desk_row(old, row, signal_keys)
        elif _row_has_signal(row, signal_keys):
            out[tk] = row
    return out


_VOL_KEYS = ("last_close", "prev_close", "pct_of_prev")
_EVENT_VOL_KEYS = ("ivr", "em_straddle", "em_event", "rr10", "skew_cboe")
_SHORT_KEYS = ("si_delta_pct", "days_to_cover", "si_shares", "squeeze_risk")
_VS_XBI_KEYS = ("relative_move", "stock_return")
_PRE_MKT_KEYS = ("pre_mkt_price_change_pct", "conviction", "pre_mkt_last")


def _merge_hourly_doc(prev: dict[str, Any] | None, nxt: dict[str, Any]) -> dict[str, Any]:
    """Deep-merge hourly snapshot — never let empty/null fields wipe a warm disk pack."""
    base = dict(prev) if isinstance(prev, dict) else {}
    if not base:
        return dict(nxt)
    out = {**base, **nxt}
    out["vol"] = _merge_hourly_column_map(base.get("vol"), nxt.get("vol"), _VOL_KEYS)
    out["event_vol"] = _merge_hourly_column_map(
        base.get("event_vol"), nxt.get("event_vol"), _EVENT_VOL_KEYS
    )
    out["short_interest"] = _merge_hourly_column_map(
        base.get("short_interest"), nxt.get("short_interest"), _SHORT_KEYS
    )
    out["vs_xbi"] = _merge_hourly_column_map(
        base.get("vs_xbi"), nxt.get("vs_xbi"), _VS_XBI_KEYS
    )
    out["pre_mkt"] = _merge_hourly_column_map(
        base.get("pre_mkt"), nxt.get("pre_mkt"), _PRE_MKT_KEYS
    )
    return out


def _stamp_column_provenance(
    rows: dict[str, Any] | None,
    *,
    source: str,
    signal_keys: tuple[str, ...],
) -> dict[str, Any]:
    """Attach `_desk: {asof, source, session_day, fields}` without changing display values."""
    out: dict[str, Any] = {}
    if not isinstance(rows, dict):
        return out
    asof = _now_iso()
    session_day = _rome_date()
    try:
        from zoneinfo import ZoneInfo

        from us_equity_session import is_nyse_trading_day

        ny = datetime.now(timezone.utc).astimezone(ZoneInfo("America/New_York")).date()
        for _ in range(10):
            ok, _ = is_nyse_trading_day(ny)
            if ok:
                session_day = ny.isoformat()
                break
            ny = ny.fromordinal(ny.toordinal() - 1)
    except Exception:
        pass
    for raw, row in rows.items():
        tk = str(raw or "").strip().upper()
        if not tk or not isinstance(row, dict):
            continue
        if not _row_has_signal(row, signal_keys):
            out[tk] = dict(row)
            continue
        fields = {
            k: {"asof": asof, "source": source, "session_day": session_day}
            for k in signal_keys
            if row.get(k) is not None
            and not (isinstance(row.get(k), float) and row.get(k) != row.get(k))
            and not (
                isinstance(row.get(k), str)
                and (not str(row.get(k)).strip() or str(row.get(k)).strip() == "—")
            )
        }
        stamped = dict(row)
        stamped["_desk"] = {
            "asof": asof,
            "source": source,
            "session_day": session_day,
            "fields": {
                **((row.get("_desk") or {}).get("fields") or {}),
                **fields,
            },
        }
        out[tk] = stamped
    return out


def _row_missing_signal(row: Any, signal_keys: tuple[str, ...]) -> bool:
    return not _row_has_signal(row if isinstance(row, dict) else None, signal_keys)


def _attach_hour_price_delta(
    prev_vol: dict[str, Any] | None,
    vol_rows: dict[str, Any],
) -> dict[str, Any]:
    """
    Stamp % price change vs the previous hourly desk pack (last_close → last_close).
    Used by Catalyst Days «Δ visit» column (before Δ24h).
    """
    prev = prev_vol if isinstance(prev_vol, dict) else {}
    out: dict[str, Any] = {}
    for tk, row in (vol_rows or {}).items():
        if not isinstance(row, dict):
            continue
        r = dict(row)
        try:
            new_last = float(r.get("last_close") or 0)
        except (TypeError, ValueError):
            new_last = 0.0
        prev_row = prev.get(tk) if isinstance(prev.get(tk), dict) else {}
        try:
            old_last = float((prev_row or {}).get("last_close") or 0)
        except (TypeError, ValueError):
            old_last = 0.0
        if new_last > 0 and old_last > 0:
            chg = (new_last - old_last) / old_last * 100.0
            # Ignore absurd jumps (bad Yahoo print); keep prior delta if any.
            if abs(chg) <= 40.0:
                r["prev_hour_close"] = round(old_last, 4)
                r["hour_chg_pct"] = round(chg, 3)
            elif (prev_row or {}).get("hour_chg_pct") is not None:
                r["hour_chg_pct"] = (prev_row or {}).get("hour_chg_pct")
                r["prev_hour_close"] = (prev_row or {}).get("prev_hour_close")
        elif (prev_row or {}).get("hour_chg_pct") is not None and new_last > 0:
            # Same pack reprint — keep last known hourly Δ.
            r["hour_chg_pct"] = (prev_row or {}).get("hour_chg_pct")
            r["prev_hour_close"] = (prev_row or {}).get("prev_hour_close") or old_last or None
        out[tk] = r
    return out


def run_hourly_desk_cache_refresh(*, force: bool = False) -> dict[str, Any]:
    """Nasdaq-hours hourly: refresh realtime desk columns into one snapshot.

    Off-hours (unless ``force``): hole-fill only tickers/pairs missing from the
    warm pack — never rewrite empty Yahoo shells over Friday prints. Clients
    are read-only; this is the sole Yahoo owner for desk columns.
    """
    try:
        from us_equity_session import is_us_equity_regular_session

        rth_ok, rth_reason = is_us_equity_regular_session()
    except Exception:
        rth_ok, rth_reason = True, "unknown"

    pairs = desk_hot_pairs(horizon_days=HOT_ZONE_DAYS)
    tickers = desk_hot_tickers(horizon_days=HOT_ZONE_DAYS)
    prev = load_hourly_cache()
    errors: list[str] = []

    # Off-hours: only fill holes for names absent from the Friday pack.
    if not force and not rth_ok:
        miss_vol = [
            t
            for t in tickers
            if _row_missing_signal((prev.get("vol") or {}).get(t), _VOL_KEYS)
        ]
        miss_si = [
            t
            for t in tickers
            if _row_missing_signal((prev.get("short_interest") or {}).get(t), _SHORT_KEYS)
        ]
        miss_vs = [
            t
            for t in tickers
            if _row_missing_signal((prev.get("vs_xbi") or {}).get(t), _VS_XBI_KEYS)
        ]
        prev_ev = prev.get("event_vol") or {}
        miss_pairs: list[tuple[str, str]] = []
        for tk, ev in pairs:
            key = f"{tk}|{ev[:10]}"
            if _row_missing_signal(prev_ev.get(key), _EVENT_VOL_KEYS):
                miss_pairs.append((tk, ev))

        patch: dict[str, Any] = {
            "updated_at": _now_iso(),
            "rome_date": prev.get("rome_date") or _rome_date(),
            "kind": "hourly",
            "tickers": tickers,
        }
        source = "server_hole_fill"

        if miss_vol:
            try:
                from market_volume_history import fetch_volume_vs_prev_session

                vol = fetch_volume_vs_prev_session(miss_vol)
                stamped = _stamp_column_provenance(
                    dict(vol.get("rows") or {}), source=source, signal_keys=_VOL_KEYS
                )
                patch["vol"] = _attach_hour_price_delta(prev.get("vol"), stamped)
            except Exception as exc:
                errors.append(f"vol:{exc}")
        if miss_pairs:
            try:
                from event_vol_index import fetch_event_vol_index

                ev = fetch_event_vol_index(miss_pairs, force=False)
                patch["event_vol"] = _stamp_column_provenance(
                    dict(ev.get("rows") or {}),
                    source=source,
                    signal_keys=_EVENT_VOL_KEYS,
                )
            except Exception as exc:
                errors.append(f"event_vol:{exc}")
        if miss_si:
            try:
                from catalyst_short_interest import fetch_catalyst_short_interest

                si = fetch_catalyst_short_interest(miss_si, force=False)
                patch["short_interest"] = _stamp_column_provenance(
                    dict(si.get("rows") or {}),
                    source=source,
                    signal_keys=_SHORT_KEYS,
                )
            except Exception as exc:
                errors.append(f"short:{exc}")
        if miss_vs:
            try:
                from catalyst_vs_xbi import fetch_catalyst_vs_xbi

                vs = fetch_catalyst_vs_xbi(miss_vs, force=False)
                patch["vs_xbi"] = _stamp_column_provenance(
                    dict(vs.get("rows") or {}),
                    source=source,
                    signal_keys=_VS_XBI_KEYS,
                )
            except Exception as exc:
                errors.append(f"vs_xbi:{exc}")

        if len(patch) <= 4:  # only meta keys — nothing missing
            logger.info(
                "Catalyst hourly hole-fill skip (market closed: %s) — pack complete vol=%s",
                rth_reason,
                len(prev.get("vol") or {}),
            )
            return {
                "ok": True,
                "skipped": "market_closed_pack_full",
                "reason": rth_reason,
                "tickers": len(prev.get("tickers") or []),
                "vol": len(prev.get("vol") or {}),
                "event_vol": len(prev.get("event_vol") or {}),
                "vs_xbi": len(prev.get("vs_xbi") or {}),
                "pre_mkt": len(prev.get("pre_mkt") or {}),
                "updated_at": prev.get("updated_at"),
                "error": None,
            }

        patch["error"] = "; ".join(errors) if errors else None
        doc = _merge_hourly_doc(prev, patch)
        _write_json(_HOURLY_PATH, doc)
        logger.info(
            "Catalyst hourly hole-fill (closed: %s): miss_vol=%s miss_ev=%s miss_si=%s miss_vs=%s",
            rth_reason,
            len(miss_vol),
            len(miss_pairs),
            len(miss_si),
            len(miss_vs),
        )
        return {
            "ok": not errors,
            "mode": "hole_fill",
            "reason": rth_reason,
            "tickers": len(tickers),
            "vol": len(doc.get("vol") or {}),
            "event_vol": len(doc.get("event_vol") or {}),
            "vs_xbi": len(doc.get("vs_xbi") or {}),
            "pre_mkt": len(doc.get("pre_mkt") or {}),
            "updated_at": doc.get("updated_at"),
            "error": doc.get("error"),
        }

    event_vol_rows: dict[str, Any] = {}
    try:
        from event_vol_index import fetch_event_vol_index

        ev = fetch_event_vol_index(pairs, force=force)
        event_vol_rows = _stamp_column_provenance(
            dict(ev.get("rows") or {}),
            source="server_hourly",
            signal_keys=_EVENT_VOL_KEYS,
        )
    except Exception as exc:
        errors.append(f"event_vol:{exc}")
        logger.warning("hourly desk event-vol failed: %s", exc)

    vs_xbi_rows: dict[str, Any] = {}
    try:
        from catalyst_vs_xbi import fetch_catalyst_vs_xbi

        vs = fetch_catalyst_vs_xbi(tickers, force=force)
        vs_xbi_rows = _stamp_column_provenance(
            dict(vs.get("rows") or {}),
            source="server_hourly",
            signal_keys=_VS_XBI_KEYS,
        )
    except Exception as exc:
        errors.append(f"vs_xbi:{exc}")
        logger.warning("hourly desk vs-xbi failed: %s", exc)

    vol_rows: dict[str, Any] = {}
    try:
        from market_volume_history import fetch_volume_vs_prev_session

        vol = fetch_volume_vs_prev_session(tickers)
        vol_rows = _stamp_column_provenance(
            dict(vol.get("rows") or {}),
            source="server_hourly",
            signal_keys=_VOL_KEYS,
        )
        vol_rows = _attach_hour_price_delta(prev.get("vol"), vol_rows)
    except Exception as exc:
        errors.append(f"vol:{exc}")
        logger.warning("hourly desk volume failed: %s", exc)

    short_rows: dict[str, Any] = {}
    try:
        from catalyst_short_interest import fetch_catalyst_short_interest

        si = fetch_catalyst_short_interest(tickers, force=False)
        short_rows = _stamp_column_provenance(
            dict(si.get("rows") or {}),
            source="server_hourly",
            signal_keys=_SHORT_KEYS,
        )
    except Exception as exc:
        errors.append(f"short:{exc}")
        logger.warning("hourly desk short-interest failed: %s", exc)

    pre_mkt_rows: dict[str, Any] = {}
    try:
        from pre_mkt_conviction import fetch_pre_mkt_conviction

        pm = fetch_pre_mkt_conviction(tickers)
        pre_mkt_rows = _stamp_column_provenance(
            dict(pm.get("rows") or {}),
            source="server_hourly",
            signal_keys=_PRE_MKT_KEYS,
        )
    except Exception as exc:
        errors.append(f"pre_mkt:{exc}")
        logger.warning("hourly desk pre-mkt failed: %s", exc)

    # G-Trends lives in the morning desk cache (once/day) — not re-polled hourly.

    fresh: dict[str, Any] = {
        "updated_at": _now_iso(),
        "rome_date": _rome_date(),
        "horizon_days": HOT_ZONE_DAYS,
        "kind": "hourly",
        "tickers": tickers,
        "vol": vol_rows,
        "event_vol": event_vol_rows,
        "short_interest": short_rows,
        "vs_xbi": vs_xbi_rows,
        "pre_mkt": pre_mkt_rows,
        "error": "; ".join(errors) if errors else None,
    }
    doc = _merge_hourly_doc(prev, fresh)
    _write_json(_HOURLY_PATH, doc)
    logger.info(
        "Catalyst hourly cache: tickers=%s vol=%s ev=%s vsxbi=%s errors=%s",
        len(tickers),
        len(doc.get("vol") or {}),
        len(doc.get("event_vol") or {}),
        len(doc.get("vs_xbi") or {}),
        doc.get("error"),
    )
    return {
        "ok": not errors,
        "tickers": len(tickers),
        "vol": len(doc.get("vol") or {}),
        "event_vol": len(doc.get("event_vol") or {}),
        "vs_xbi": len(doc.get("vs_xbi") or {}),
        "pre_mkt": len(doc.get("pre_mkt") or {}),
        "updated_at": doc["updated_at"],
        "error": doc.get("error"),
    }


def load_morning_cache() -> dict[str, Any]:
    return _read_json(_MORNING_PATH) or {
        "updated_at": None,
        "rome_date": None,
        "events": [],
        "accumulation": {},
        "trends": {},
        "fda_brief": {},
        "tickers": [],
    }


def load_hourly_cache() -> dict[str, Any]:
    return _read_json(_HOURLY_PATH) or {
        "updated_at": None,
        "rome_date": None,
        "vol": {},
        "event_vol": {},
        "short_interest": {},
        "vs_xbi": {},
        "pre_mkt": {},
        "tickers": [],
    }


def load_desk_cache() -> dict[str, Any]:
    morning = load_morning_cache()
    hourly = load_hourly_cache()
    return {
        "updated_at": _now_iso(),
        "horizon_days": HOT_ZONE_DAYS,
        "morning": morning,
        "hourly": hourly,
        "morning_updated_at": morning.get("updated_at"),
        "hourly_updated_at": hourly.get("updated_at"),
    }


def due_for_morning_desk_cache(
    now_local: datetime,
    *,
    last_date: date | None,
    at_hour: int = 7,
    at_minute: int = 10,
) -> bool:
    """True once per Mon–Fri after morning migrate window."""
    if now_local.weekday() >= 5:
        return False
    today = now_local.date()
    if last_date == today:
        return False
    return (now_local.hour, now_local.minute) >= (at_hour, at_minute)
