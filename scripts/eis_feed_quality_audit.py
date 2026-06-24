#!/usr/bin/env python3
"""Audit EIS clinical feed quality — cross-company contamination metrics."""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from prediction.eis_feed_quality import (  # noqa: E402
    event_has_usable_reference_text,
    filter_trusted_snapshot_records,
    is_study_sponsor_trusted,
    is_valid_feed_ticker,
    sanitize_record_events,
)


def _load_snapshot(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return list(raw.get("records") or [])


def audit_records(records: list[dict]) -> dict:
    invalid_tickers = 0
    untrusted_sponsor = 0
    empty_title_events = 0
    unverified_events = 0
    verified_events = 0
    eis_without_price = 0
    eis_total = 0
    per_ticker_events: Counter[str] = Counter()

    for rec in records:
        tk = str(rec.get("ticker") or "").upper()
        if not is_valid_feed_ticker(tk):
            invalid_tickers += 1
            continue
        sm = str(rec.get("sponsor_match") or "").strip().lower()
        if not is_study_sponsor_trusted(rec):
            untrusted_sponsor += 1
        events = rec.get("clinical_events") or rec.get("timeline_events") or []
        for ev in events:
            if not isinstance(ev, dict):
                continue
            per_ticker_events[tk] += 1
            if not event_has_usable_reference_text(ev):
                empty_title_events += 1
            if ev.get("reference_verified") is True:
                verified_events += 1
            else:
                st = str(ev.get("source_type") or "").lower()
                if st != "sec_8k":
                    unverified_events += 1
            eis = ev.get("eis")
            if isinstance(eis, dict) and eis.get("score") is not None:
                eis_total += 1
                price = ev.get("price") if isinstance(ev.get("price"), dict) else {}
                if price.get("delta_p_1d") is None and price.get("delta_p_3d") is None:
                    eis_without_price += 1

    return {
        "records": len(records),
        "invalid_tickers": invalid_tickers,
        "untrusted_sponsor": untrusted_sponsor,
        "events_total": sum(per_ticker_events.values()),
        "empty_title_events": empty_title_events,
        "verified_events": verified_events,
        "unverified_events": unverified_events,
        "eis_scored": eis_total,
        "eis_without_price": eis_without_price,
        "top_tickers_by_events": per_ticker_events.most_common(10),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="EIS feed quality audit")
    parser.add_argument(
        "--snapshot",
        default=str(ROOT / "data" / "clinical_pre_cd_enrichment_snapshot.json"),
    )
    parser.add_argument("--sanitize", action="store_true", help="Rewrite snapshot with strict gates")
    args = parser.parse_args()
    path = Path(args.snapshot)
    if not path.is_file():
        print(f"Snapshot not found: {path}", file=sys.stderr)
        return 1

    records = _load_snapshot(path)
    before = audit_records(records)
    print("=== EIS feed quality (before) ===")
    for k, v in before.items():
        if k != "top_tickers_by_events":
            print(f"  {k}: {v}")

    if args.sanitize:
        clean = filter_trusted_snapshot_records(records)
        after = audit_records(clean)
        payload = {
            "updated_at": json.loads(path.read_text(encoding="utf-8")).get("updated_at"),
            "months_before_cd": json.loads(path.read_text(encoding="utf-8")).get("months_before_cd"),
            "count": len(clean),
            "ai_ok_count": sum(1 for r in clean if r.get("ai_ok")),
            "records": clean,
        }
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        tmp.replace(path)
        print("\n=== EIS feed quality (after sanitize) ===")
        for k, v in after.items():
            if k != "top_tickers_by_events":
                print(f"  {k}: {v}")
        print(f"\nSanitized snapshot written: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
