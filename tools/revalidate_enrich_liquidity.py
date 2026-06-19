#!/usr/bin/env python3
"""Re-fetch FY liquidity for all ``data/enrich_cache/*.json`` entries (systemic fix)."""
from __future__ import annotations

import argparse
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from prediction.financial_liquidity import (  # noqa: E402
    CR_SANITY_MAX,
    revalidate_enrich_cache_file,
    scan_enrich_cache_insane_ratios,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache-dir",
        default=os.path.join(_ROOT, "data", "enrich_cache"),
        help="Path to enrich_cache directory",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan only; do not rewrite JSON files",
    )
    parser.add_argument(
        "--only-insane",
        action="store_true",
        help="Revalidate only tickers with CR outside sane band (scan first)",
    )
    args = parser.parse_args()
    cache_dir = os.path.abspath(args.cache_dir)
    if not os.path.isdir(cache_dir):
        print(f"[revalidate] Missing cache dir: {cache_dir}")
        return 1

    hard_bad = scan_enrich_cache_insane_ratios(cache_dir)
    soft_high = scan_enrich_cache_insane_ratios(cache_dir, min_cr=CR_SANITY_MAX)
    insane = {sym for sym, _ in hard_bad} | {sym for sym, _ in soft_high}
    if hard_bad:
        print(f"[revalidate] Pre-scan: {len(hard_bad)} cache files with CR > hard max or < min")
    if soft_high and not args.only_insane:
        print(
            f"[revalidate] Note: {len(soft_high)} files with CR > {CR_SANITY_MAX:g} "
            "(cash-rich; OK if cross-checked on re-fetch)"
        )

    ok = cleared = skipped = 0
    for name in sorted(os.listdir(cache_dir)):
        if not name.lower().endswith(".json"):
            continue
        sym = name[:-5].upper()
        if args.only_insane and sym not in insane:
            continue
        path = os.path.join(cache_dir, name)
        summary = revalidate_enrich_cache_file(path, rewrite=not args.dry_run)
        action = summary.get("action")
        if action == "ok":
            ok += 1
        elif action == "cleared":
            cleared += 1
        else:
            skipped += 1
        if action in ("ok", "cleared"):
            print(
                f"  {sym}: {action} "
                f"old_cr={summary.get('old_cr')} new_cr={summary.get('cr')}"
            )

    print(
        f"[revalidate] Done — ok={ok} cleared={cleared} skipped={skipped}"
        + (" (dry-run)" if args.dry_run else "")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
