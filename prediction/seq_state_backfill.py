"""
Backfill historical as-of node snapshots into ``pred_curve_seq_state.json``.

For each past catalyst in ``past_catalyst_predictions.json``, rebuilds seq curve
nodes without look-ahead (``compute_seq_curve_asof`` at ``CD + offset``) and
merges into ``events[TICKER|CD].node_snapshots`` (never overwrites existing keys).
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
from typing import Any

from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON
from past_pred_io import load_past_pred_map, normalize_past_pred_record
from prediction.config import CURVE_SEQ_STATE_PATH
from prediction.seq_calib import (
    DEFAULT_CAL_OFFSETS,
    _merge_node_snapshots,
    compute_seq_curve_asof,
    pred_curve_close_cal,
    pred_curve_seq_load,
    pred_curve_seq_save,
    pred_curve_trade_date_at_offset,
)


def _parse_cd(raw: Any) -> date | None:
    if isinstance(raw, date):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            return date.fromisoformat(raw.strip()[:10])
        except ValueError:
            return None
    return None


def _event_key(rec: dict, fallback_key: str) -> str:
    tk = str(rec.get("ticker") or fallback_key.split("|")[0]).strip().upper()
    cd = _parse_cd(rec.get("completion_date"))
    if cd is None and "|" in fallback_key:
        cd = _parse_cd(fallback_key.split("|", 1)[1])
    if not tk or cd is None:
        return fallback_key
    return f"{tk}|{cd.isoformat()}"


def _raw_model_from_record(rec: dict, offsets: tuple[int, ...]) -> list[float | None] | None:
    import data_orchestrator as orch

    pw = dict(rec)
    orch._accuracy_sim_impute_missing_pre_cd_model_pcts(pw)
    orch._accuracy_sim_synthesize_interp_nodes_from_post_d_only(pw)
    raw = orch._interp_pred_pct_vs_m60_calendar(
        pw,
        offsets,
        log_row_key=None,
        pair_empty_logged=None,
    )
    if not isinstance(raw, list) or len(raw) < len(offsets):
        return None
    return raw


def build_node_snapshots_for_event(
    *,
    key: str,
    rec: dict,
    close_series,
    offsets: tuple[int, ...] | None = None,
    existing_snaps: dict | None = None,
    today: date | None = None,
) -> tuple[dict, dict]:
    """
    Return ``(incoming_snapshots, meta)`` for one ``TICKER|CD`` event.

    ``meta`` keys: ``skipped_reason``, ``p60``, ``n_added``, ``n_existing``.
    """
    offs = offsets or DEFAULT_CAL_OFFSETS
    meta: dict[str, Any] = {"key": key, "n_added": 0, "n_existing": 0}
    existing = dict(existing_snaps) if isinstance(existing_snaps, dict) else {}
    meta["n_existing"] = len(existing)

    if close_series is None or getattr(close_series, "empty", True):
        meta["skipped_reason"] = "no_price_series"
        return {}, meta

    part = key.split("|", 1)
    if len(part) != 2:
        meta["skipped_reason"] = "bad_key"
        return {}, meta
    cd = _parse_cd(part[1])
    if cd is None:
        meta["skipped_reason"] = "bad_cd"
        return {}, meta

    ref_today = today or date.today()
    if ref_today < cd + timedelta(days=int(offs[0])):
        meta["skipped_reason"] = "cd_too_recent"
        return {}, meta

    p60 = pred_curve_close_cal(close_series, cd, -60)
    if p60 is None or float(p60) <= 0:
        meta["skipped_reason"] = "no_p60"
        return {}, meta
    meta["p60"] = float(p60)

    raw = _raw_model_from_record(rec, offs)
    if raw is None:
        meta["skipped_reason"] = "no_raw_model"
        return {}, meta

    incoming: dict[str, dict] = {}
    for i, off in enumerate(offs):
        snap_key = str(int(off))
        if snap_key in existing:
            continue
        as_of_cal = cd + timedelta(days=int(off))
        if as_of_cal > ref_today:
            continue
        sub = compute_seq_curve_asof(
            close_series=close_series,
            cd=cd,
            today=as_of_cal,
            raw_model=raw,
            p60=float(p60),
            offsets=offs,
            beta_seq=None,
        )
        if sub is None or i >= len(sub.get("adj") or []):
            continue
        td_i = pred_curve_trade_date_at_offset(close_series, cd, int(off))
        incoming[snap_key] = {
            "as_of_date": as_of_cal.isoformat(),
            "trade_date": td_i.isoformat() if td_i is not None else None,
            "model_pct_vs_m60": raw[i] if i < len(raw) else None,
            "seq_pct_vs_m60": sub["adj"][i],
            "actual_pct_vs_m60": sub["act"][i] if i < len(sub["act"]) else None,
        }
        meta["n_added"] += 1

    return incoming, meta


def backfill_seq_state_from_past_catalyst(
    rows: dict[str, dict] | None = None,
    *,
    json_path: str | None = None,
    state_path: str | None = None,
    lookback: int | None = None,
    tickers: list[str] | None = None,
    today: date | None = None,
    dry_run: bool = False,
    save_every: int = 200,
) -> dict[str, Any]:
    """
    Merge historical node snapshots for past catalyst rows into seq state file.
    """
    import data_orchestrator as orch

    ref_today = today or date.today()
    src = load_past_pred_map(json_path or PAST_CATALYST_PREDICTIONS_JSON)
    if rows is not None:
        src = rows

    if tickers:
        tk_set = {t.strip().upper() for t in tickers if t.strip()}
        src = {
            k: v
            for k, v in src.items()
            if str(v.get("ticker", k.split("|")[0])).upper() in tk_set
        }

    past_items: list[tuple[str, dict, date]] = []
    for k, v in src.items():
        rec = normalize_past_pred_record(dict(v))
        cd = _parse_cd(rec.get("completion_date"))
        if cd is None or cd >= ref_today:
            continue
        ek = _event_key(rec, k)
        past_items.append((ek, rec, cd))
    past_items.sort(key=lambda x: x[2], reverse=True)

    if lookback and lookback > 0:
        past_items = past_items[:lookback]

    doc = pred_curve_seq_load(state_path or CURVE_SEQ_STATE_PATH)
    ev = doc.setdefault("events", {})
    close_cache: dict[str, Any] = {}

    stats = {
        "events_scanned": len(past_items),
        "events_updated": 0,
        "snapshots_added": 0,
        "skipped_no_series": 0,
        "skipped_no_model": 0,
        "skipped_other": 0,
        "dry_run": dry_run,
    }

    dirty = False
    for idx, (ek, rec, _cd) in enumerate(past_items, start=1):
        tk = ek.split("|", 1)[0]
        if tk not in close_cache:
            close_cache[tk] = orch._pcache_series_for_calibration(tk)
        ser = close_cache[tk]

        existing_snaps = dict((ev.get(ek) or {}).get("node_snapshots") or {})
        incoming, meta = build_node_snapshots_for_event(
            key=ek,
            rec=rec,
            close_series=ser,
            existing_snaps=existing_snaps,
            today=ref_today,
        )
        reason = meta.get("skipped_reason")
        if reason == "no_price_series":
            stats["skipped_no_series"] += 1
            continue
        if reason == "no_raw_model":
            stats["skipped_no_model"] += 1
            continue
        if reason and meta.get("n_added", 0) == 0 and not existing_snaps:
            stats["skipped_other"] += 1
            continue

        if not incoming:
            continue

        merged = _merge_node_snapshots(existing_snaps, incoming)
        entry = dict(ev.get(ek) or {})
        entry.setdefault("ticker", tk)
        entry.setdefault("cd", _cd.isoformat())
        if meta.get("p60") is not None:
            entry["p60_usd"] = meta["p60"]
        entry["node_snapshots"] = merged
        entry["backfill_as_of"] = ref_today.isoformat()
        ev[ek] = entry
        stats["events_updated"] += 1
        stats["snapshots_added"] += meta.get("n_added", 0)
        dirty = True

        if not dry_run and save_every > 0 and idx % save_every == 0 and dirty:
            pred_curve_seq_save(doc, state_path or CURVE_SEQ_STATE_PATH)
            dirty = False

    if dirty and not dry_run:
        pred_curve_seq_save(doc, state_path or CURVE_SEQ_STATE_PATH)

    stats["events_in_state"] = len(ev)
    stats["with_node_snapshots"] = sum(
        1 for v in ev.values() if isinstance(v, dict) and v.get("node_snapshots")
    )
    return stats


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Backfill seq node snapshots for past catalysts")
    p.add_argument("--lookback", type=int, default=0, help="Max past events (0 = all)")
    p.add_argument("--ticker", action="append", default=[], help="Limit to ticker(s)")
    p.add_argument("--dry-run", action="store_true", help="Compute stats without writing")
    p.add_argument("--save-every", type=int, default=200, help="Incremental save interval")
    args = p.parse_args(argv)
    lookback = args.lookback if args.lookback > 0 else None
    stats = backfill_seq_state_from_past_catalyst(
        lookback=lookback,
        tickers=args.ticker or None,
        dry_run=args.dry_run,
        save_every=args.save_every,
    )
    print(
        f"[seq_backfill] scanned={stats['events_scanned']} "
        f"updated={stats['events_updated']} "
        f"snapshots_added={stats['snapshots_added']} "
        f"with_snaps={stats['with_node_snapshots']} "
        f"skip_series={stats['skipped_no_series']} "
        f"skip_model={stats['skipped_no_model']}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
