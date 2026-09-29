#!/usr/bin/env python3
"""
One-off migration: neutralize the EIS of hypotheses already stored in the
clinical enrichment snapshot, and load them into the pending-verification
registry so the verifier can pick them up.

Historic rows were scored before the confirmation gate existed: the AI invented
a plausible ``event_date``, the market enrichment resolved it against yfinance,
and an unrelated price move became clinical alpha (up to EIS +25 in production).

    python scripts/migrate_gate_anticipated_events.py --dry-run
    python scripts/migrate_gate_anticipated_events.py
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from prediction.eis_feed_quality import (  # noqa: E402
    ANTICIPATED,
    annotate_event_confirmation,
    classify_event_confirmation,
    neutralize_anticipated_event_score,
)
from prediction.eis_pending_verification import upsert_hypotheses  # noqa: E402

_SNAPSHOT = _ROOT / "data" / "clinical_pre_cd_enrichment_snapshot.json"


def _eis_score(ev: dict) -> float | None:
    v = ev.get("eis")
    return v.get("score") if isinstance(v, dict) else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--no-registry", action="store_true", help="skip the registry upsert")
    args = ap.parse_args()

    snap = json.loads(_SNAPSHOT.read_text(encoding="utf-8"))
    records = [r for r in (snap.get("records") or []) if isinstance(r, dict)]

    gated = 0
    score_removed = 0.0
    queued = 0
    per_ticker: dict[str, int] = {}

    for rec in records:
        ticker = str(rec.get("ticker") or "").upper()
        events = [e for e in (rec.get("clinical_events") or []) if isinstance(e, dict)]
        if not events:
            continue
        out = []
        anticipated_rows = []
        for ev in events:
            verdict = classify_event_confirmation(ev)
            row = annotate_event_confirmation(ev)
            if verdict["status"] == ANTICIPATED:
                score = _eis_score(ev)
                if score is not None:
                    score_removed += abs(score)
                row = neutralize_anticipated_event_score(row)
                gated += 1
                per_ticker[ticker] = per_ticker.get(ticker, 0) + 1
                anticipated_rows.append(row)
            out.append(row)

        if not args.dry_run:
            rec["clinical_events"] = out
            rec["timeline_events"] = out

        if anticipated_rows and not args.no_registry and not args.dry_run:
            stats = upsert_hypotheses(
                anticipated_rows,
                ticker=ticker,
                company=str(rec.get("company") or ""),
                nct_id=str(rec.get("nct_id") or ""),
            )
            queued += stats.get("added", 0)

    print(f"studi                    : {len(records)}")
    print(f"eventi neutralizzati     : {gated}")
    print(f"|EIS| rimosso            : {score_removed:.1f}")
    print(f"ipotesi messe in coda    : {queued}")
    top = sorted(per_ticker.items(), key=lambda kv: -kv[1])[:10]
    print("top ticker               :", ", ".join(f"{t}={n}" for t, n in top) or "—")

    if args.dry_run:
        print("\nDRY-RUN — nessuna scrittura")
        return 0

    backup = _SNAPSHOT.with_suffix(f".pre_gate_{datetime.now():%Y%m%d_%H%M%S}.json")
    shutil.copy2(_SNAPSHOT, backup)
    snap["records"] = records
    snap["anticipated_gate_migrated_at"] = datetime.now().isoformat()
    tmp = _SNAPSHOT.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(snap, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    tmp.replace(_SNAPSHOT)
    print(f"\nbackup                   : {backup.name}")
    print("snapshot aggiornato")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
