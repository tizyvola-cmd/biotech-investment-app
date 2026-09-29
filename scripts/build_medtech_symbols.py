#!/usr/bin/env python3
"""
Build / refresh data/medtech_symbols.json and sync into biotech_symbols.json.

  py -3 scripts/build_medtech_symbols.py
  py -3 scripts/build_medtech_symbols.py --no-ctgov
  py -3 scripts/build_medtech_symbols.py --sync-only
"""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from medtech_universe import (  # noqa: E402
    DATA_DIR,
    MEDTECH_SYMBOLS_JSON,
    build_medtech_universe,
    load_json_list,
    sync_medtech_to_biotech_symbols,
)

DESKTOP_TS = os.path.join(ROOT, "desktop-ui", "src", "sheet", "medtechSymbols.ts")
SNAPSHOT_JSON = os.path.join(DATA_DIR, "medtech_symbols_snapshot.json")


def write_desktop_artifacts(tickers: list[str]) -> None:
    """Desktop snapshot JSON + TS curated fallback array."""
    os.makedirs(DATA_DIR, exist_ok=True)
    snap_payload = {
        "generated_at": __import__("datetime").date.today().isoformat(),
        "source": MEDTECH_SYMBOLS_JSON,
        "count": len(tickers),
        "tickers": tickers,
    }
    with open(SNAPSHOT_JSON, "w", encoding="utf-8") as fh:
        json.dump(snap_payload, fh, indent=2, ensure_ascii=False)
    print(f"[medtech] snapshot -> {SNAPSHOT_JSON} ({len(tickers)} tickers)")

    if not os.path.isfile(DESKTOP_TS):
        print(f"[medtech] skip TS sync — missing {DESKTOP_TS}")
        return

    lines = [f'  "{t}",' for t in tickers]
    block = "export const CURATED_MEDTECH_SYMBOLS: readonly string[] = [\n" + "\n".join(lines) + "\n];"
    with open(DESKTOP_TS, encoding="utf-8") as fh:
        src = fh.read()
    import re as _re

    patched, n = _re.subn(
        r"export const CURATED_MEDTECH_SYMBOLS: readonly string\[\] = \[[\s\S]*?\];",
        block,
        src,
        count=1,
    )
    if n == 1:
        with open(DESKTOP_TS, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(patched)
        print(f"[medtech] synced CURATED_MEDTECH_SYMBOLS in {DESKTOP_TS}")
    else:
        print("[medtech] TS sync skipped — CURATED_MEDTECH_SYMBOLS block not found")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build medtech ticker universe")
    ap.add_argument("--no-ctgov", action="store_true", help="Skip CT.gov device CD discovery")
    ap.add_argument("--no-etf", action="store_true", help="Skip IHI/XHE ETF top holdings")
    ap.add_argument("--no-sync", action="store_true", help="Do not merge into biotech_symbols.json")
    ap.add_argument("--sync-only", action="store_true", help="Only sync existing medtech_symbols → biotech")
    ap.add_argument("--days", type=int, default=120, help="CT.gov CD horizon (default 120)")
    ap.add_argument("--pages", type=int, default=15, help="Max CT.gov pages")
    args = ap.parse_args()

    before = len(load_json_list(MEDTECH_SYMBOLS_JSON))

    if args.sync_only:
        med = load_json_list(MEDTECH_SYMBOLS_JSON)
        if not med:
            print("[medtech] medtech_symbols.json vuoto — run without --sync-only first")
            return 1
        sync_medtech_to_biotech_symbols(med)
        return 0

    tickers = build_medtech_universe(
        include_etf=not args.no_etf,
        include_curated=True,
        include_ctgov=not args.no_ctgov,
        ctgov_horizon_days=args.days,
        ctgov_max_pages=args.pages,
    )
    added = len(tickers) - before
    print(f"[medtech] medtech_symbols.json: {len(tickers)} ticker ({added:+d} vs prior)")

    if not args.no_sync:
        sync_medtech_to_biotech_symbols(tickers)

    write_desktop_artifacts(tickers)

    # Write discovery report sidecar for desktop audit scripts
    report_path = os.path.join(ROOT, "data", "medtech_universe_report.json")
    try:
        with open(report_path, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "count": len(tickers),
                    "tickers": tickers,
                    "sources": {
                        "etf": list([] if args.no_etf else ["IHI", "XHE"]),
                        "curated": True,
                        "ctgov": not args.no_ctgov,
                    },
                },
                fh,
                indent=2,
                ensure_ascii=False,
            )
    except OSError as exc:
        print(f"[medtech] report write skip: {exc}")

    preview = ", ".join(tickers[:30])
    if len(tickers) > 30:
        preview += f" … (+{len(tickers) - 30})"
    print(f"[medtech] Preview: {preview}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
