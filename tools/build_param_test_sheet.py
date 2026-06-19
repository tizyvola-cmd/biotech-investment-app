#!/usr/bin/env python3
"""
Stub — export foglio «Parametri — test» (design: docs/design_parametri_test_v4_v5.md).

MVP Week 1: legge past_catalyst_predictions.json + righe Accuracy merge,
emette CSV con snapshot parametri + errori v4/v5 per orizzonte.

Uso previsto:
  python tools/build_param_test_sheet.py --out data/param_test_export.csv
  python tools/build_param_test_sheet.py --xlsx  # append foglio Excel (Week 2+)

Non sovrascrive colonne note manuali se integrate nel workbook (vedi design §C).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def main() -> int:
    p = argparse.ArgumentParser(description="Export Parametri — test (stub)")
    p.add_argument(
        "--out",
        type=Path,
        default=_ROOT / "data" / "param_test_export.csv",
        help="CSV di output",
    )
    p.add_argument("--xlsx", action="store_true", help="Scrive foglio nel FINAL_XLSX (non implementato)")
    args = p.parse_args()
    print(
        "build_param_test_sheet: stub — implementare join past_pred + accuracy per",
        args.out,
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
