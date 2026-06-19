#!/usr/bin/env python3
"""Close pending signal outcomes and rebuild data/signal_calibration.json."""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from prediction.signal_audit import build_calibration_document, close_pending_outcomes


def main() -> int:
    n = close_pending_outcomes()
    doc = build_calibration_document(close_outcomes_first=False)
    print(
        f"[SignalCalib] closed={n} log_rows={doc.get('log_rows')} "
        f"useful_hit={doc.get('cohorts', {}).get('useful', {}).get('hit_pct')}%",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
