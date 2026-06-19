#!/usr/bin/env python3
"""Backfill ``*_fit_pct`` + layer-i empirical blend on past_catalyst_predictions.json."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    ap = argparse.ArgumentParser(description="Backfill past_pred fit_pct + emp precat blend.")
    ap.add_argument("--force", action="store_true", help="Re-apply blend even if already set.")
    ap.add_argument("--json", default="", help="Override JSON path.")
    args = ap.parse_args()

    from data_orchestrator import _enrich_past_pred_calib_empirical, _load_calibration_state
    from past_pred_io import load_past_pred_document, rows_map_from_doc, save_predictions
    from prediction.past_pred_fit_enrich import enrich_past_pred_fit_horizons_metadata
    from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON

    path = args.json or PAST_CATALYST_PREDICTIONS_JSON
    doc = load_past_pred_document(path)
    rows = rows_map_from_doc(doc)
    calib = _load_calibration_state() or {}
    print(f"[backfill] righe={len(rows)} calib={'ok' if calib else 'empty'}")
    _enrich_past_pred_calib_empirical(rows, calib)
    n = enrich_past_pred_fit_horizons_metadata(rows, calib, force=args.force)
    if n:
        doc["rows"] = doc.get("rows") or {}
        for k, rec in rows.items():
            if str(k) in doc["rows"]:
                doc["rows"][str(k)].update(rec)
        save_predictions(doc, json_path=path)
    print(json.dumps({"n_rows": len(rows), "n_updated": n}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
