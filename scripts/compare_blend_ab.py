#!/usr/bin/env python3
"""CLI wrapper for ``prediction.blend_ab_eval`` — layer i A/B OFF vs ON."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _print_summary(label: str, summary: dict) -> None:
    print(f"\n{'=' * 72}")
    print(label)
    print(f"{'=' * 72}")
    if not summary.get("n"):
        print("  Nessun evento valutabile.")
        return
    print(f"  Eventi: {summary['n']}")
    if summary.get("n_proxy_raw"):
        print(f"  Nota: {summary['n_proxy_raw']} con proxy raw su past_pred")
    print(
        f"  RMSE medio  OFF={summary.get('rmse_off_mean_pp')} pp  "
        f"ON={summary.get('rmse_on_mean_pp')} pp  "
        f"Δ={summary.get('delta_rmse_mean_pp'):+.3f} pp"
    )
    if summary.get("hit_off_pct") is not None:
        print(
            f"  Hit T−5     OFF={summary['hit_off_pct']}%  "
            f"ON={summary['hit_on_pct']}%  (n={summary.get('n_hit')})"
        )
    print(
        f"  Vincitori RMSE: ON={summary.get('wins_on')}  "
        f"OFF={summary.get('wins_off')}  pareggio={summary.get('ties')}"
    )


def main() -> int:
    from prediction.blend_ab_eval import evaluate_blend_ab

    ap = argparse.ArgumentParser(description="A/B empirical precat blend (layer i).")
    ap.add_argument("--source", choices=("charts", "live", "past", "all"), default="all")
    ap.add_argument("--past-only", action="store_true")
    ap.add_argument("--top", type=int, default=8)
    ap.add_argument("--csv", type=str, default="")
    args = ap.parse_args()

    doc = evaluate_blend_ab(source=args.source, past_only=args.past_only, top_n=args.top)
    summary = doc.get("summary") or {}
    print("=== A/B empirical precat blend (layer i) ===")
    print(f"Fonte: {args.source}  past-only={args.past_only}  eventi={summary.get('n', 0)}")
    _print_summary("RIEPILOGO COORTE", summary)
    for src, sub in (doc.get("by_source") or {}).items():
        _print_summary(f"PER FONTE — {src}", sub)

    if args.top and doc.get("top_improvements"):
        print(f"\n--- Top {args.top} miglioramenti ---")
        for r in doc["top_improvements"]:
            print(
                f"  {r.get('ticker')} {r.get('cd')}  ΔRMSE={r.get('delta_rmse_pp'):+.2f} pp  "
                f"[{r.get('source')}]"
            )

    if args.csv:
        # Full event export requires extending evaluate_blend_ab to return events — skip for CLI brevity
        Path(args.csv).write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nJSON → {args.csv}")

    return 0 if summary.get("n") else 1


if __name__ == "__main__":
    raise SystemExit(main())
