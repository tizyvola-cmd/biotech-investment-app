#!/usr/bin/env python3
"""Phase 0 — audit dimensioni snapshot in ``data/`` (read-only).

Stampa i file JSON più pesanti, stima righe/chiavi dove possibile,
e segnala i candidati transfer/render più probabili.

Uso::

    .venv\\Scripts\\python.exe scripts\\phase0_payload_audit.py
    .venv\\Scripts\\python.exe scripts\\phase0_payload_audit.py --top 25
    .venv\\Scripts\\python.exe scripts\\phase0_payload_audit.py --json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import DATA_DIR

# Snapshot noti nel percorso critico desktop (project-data / IPC fallback)
PHASE0_HOT_FILES = (
    "simulation_sheet_snapshot.json",
    "simulation_charts_snapshot.json",
    "past_catalyst_predictions.json",
    "clinical_pre_cd_enrichment_snapshot.json",
    "clinical_simulation_snapshot.json",
    "financial_sheet_snapshot.json",
    "accuracy_sheet_snapshot.json",
    "sds_snapshot.json",
    "desktop_data_manifest.json",
    "signal_calibration.json",
    "cd_pattern_polygon_accuracy.json",
    "regulatory_risk_snapshot.json",
    "mobile_dashboard_snapshot.json",
    "invest_sim_inputs.json",
    "invest_sim_history.json",
)


def _fmt_bytes(n: int) -> str:
    if n >= 1_048_576:
        return f"{n / 1_048_576:.2f} MB"
    if n >= 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n} B"


def _shape_hint(path: Path) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except Exception as exc:
        return f"parse-error: {exc}"

    if isinstance(doc, list):
        return f"list[{len(doc)}]"
    if not isinstance(doc, dict):
        return type(doc).__name__

    hints: list[str] = []
    for key in ("rows", "tickers", "entries", "studies", "events", "companies"):
        val = doc.get(key)
        if isinstance(val, list):
            hints.append(f"{key}={len(val)}")
        elif isinstance(val, dict):
            hints.append(f"{key}={len(val)} keys")

    sheets = doc.get("sheets")
    if isinstance(sheets, dict):
        for name, meta in sheets.items():
            if isinstance(meta, dict) and "row_count" in meta:
                hints.append(f"sheet.{name}.rows={meta['row_count']}")

    table = doc.get("table")
    if isinstance(table, dict):
        rows = table.get("rows")
        if isinstance(rows, list):
            hints.append(f"table.rows={len(rows)}")

    return ", ".join(hints) if hints else f"dict[{len(doc)} keys]"


def _audit(top: int, include_all_json: bool) -> list[dict[str, object]]:
    data_root = Path(DATA_DIR)
    if not data_root.is_dir():
        raise SystemExit(f"data/ non trovato: {data_root}")

    if include_all_json:
        paths = sorted(data_root.rglob("*.json"))
    else:
        paths = [data_root / name for name in PHASE0_HOT_FILES]

    rows: list[dict[str, object]] = []
    seen: set[Path] = set()
    for path in paths:
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        size = path.stat().st_size
        rows.append(
            {
                "path": str(path.relative_to(data_root)).replace("\\", "/"),
                "bytes": size,
                "size": _fmt_bytes(size),
                "shape": _shape_hint(path),
                "hot": path.name in PHASE0_HOT_FILES,
            }
        )

    # Aggiungi altri JSON in data/ non nella lista hot
    if not include_all_json:
        for path in sorted(data_root.rglob("*.json")):
            if path in seen:
                continue
            seen.add(path)
            size = path.stat().st_size
            if size < 50_000:
                continue
            rows.append(
                {
                    "path": str(path.relative_to(data_root)).replace("\\", "/"),
                    "bytes": size,
                    "size": _fmt_bytes(size),
                    "shape": _shape_hint(path) if size <= 5_000_000 else "skipped-shape (>5MB)",
                    "hot": False,
                }
            )

    rows.sort(key=lambda r: int(r["bytes"]), reverse=True)
    return rows[:top]


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 0 payload audit (data/*.json)")
    parser.add_argument("--top", type=int, default=20, help="Numero file da mostrare")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Includi tutti i .json sotto data/ (non solo hot list)",
    )
    parser.add_argument("--json", action="store_true", help="Output JSON machine-readable")
    args = parser.parse_args()

    rows = _audit(top=max(1, args.top), include_all_json=args.all)

    if args.json:
        print(json.dumps({"data_dir": str(DATA_DIR), "files": rows}, indent=2))
        return 0

    print("=" * 78)
    print("SUPERNOVA PHASE 0 — PAYLOAD AUDIT (read-only)")
    print(f"data/: {DATA_DIR}")
    print("=" * 78)
    print(f"{'SIZE':>12}  {'PATH':<48}  SHAPE")
    print("-" * 78)
    for row in rows:
        hot = "*" if row.get("hot") else " "
        print(
            f"{row['size']:>12}  {hot}{row['path']:<47}  {row['shape']}"
        )
    print("-" * 78)
    total_mb = sum(int(r["bytes"]) for r in rows) / 1_048_576
    print(f"Top {len(rows)} files shown — combined ~{total_mb:.1f} MB")
    print()
    print("Abilita telemetria runtime:")
    print("  Backend:  set SUPERNOVA_API_PERF=1  (riavvia supernova_api)")
    print("  Frontend: localStorage.setItem('SUPERNOVA_PERF','1'); location.reload()")
    print("  React:    DevTools -> Profiler (commit time / re-render count)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
