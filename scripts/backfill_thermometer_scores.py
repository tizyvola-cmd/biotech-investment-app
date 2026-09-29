#!/usr/bin/env python3
"""
Force re-score taxonomy / thermometer fields on persisted EIS-related stores.

Targets:
  - data/cache/daily_news_desk.json  (items, top_news, highlights, briefs, …)
  - data/clinical_pre_cd_enrichment_snapshot.json  (records with taxonomy)

Writes thermometer_importance + refreshed Clin/Fin/Corp/Access chips from
current eis_taxonomy_scoring + catalyst_benchmark.

Usage (on VPS or local):
  cd /opt/biotech && .venv/bin/python scripts/backfill_thermometer_scores.py
  cd /opt/biotech && .venv/bin/python scripts/backfill_thermometer_scores.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DIM_KEYS = (
    "clinical_score",
    "financial_score",
    "corporate_score",
    "market_access_score",
    "market_access_notes",
    "taxonomy_dimensions",
    "taxonomy_version",
    "taxonomy_method",
    "taxonomy_review_flags",
    "taxonomy_audit",
    "heuristic_rev",
    "eis_score",
    "eis",
)


def _text_blob(row: dict[str, Any]) -> str:
    parts: list[str] = []
    for k in (
        "title",
        "headline",
        "event_title",
        "summary_10w",
        "summary",
        "summary_long",
        "detail_summary",
        "source_excerpt",
        "abstract",
        "impact_note",
        "timing_quote",
        "raw_snippet",
        "body",
        "text",
    ):
        v = row.get(k)
        if v:
            parts.append(str(v))
    for k in ("key_results", "key_points", "results"):
        v = row.get(k)
        if isinstance(v, list):
            parts.extend(str(x) for x in v if x)
        elif v:
            parts.append(str(v))
    # Nested news brief
    brief = row.get("brief")
    if isinstance(brief, dict):
        parts.append(_text_blob(brief))
    return " ".join(p for p in parts if p).strip()


def _has_taxonomy_payload(row: dict[str, Any]) -> bool:
    if not isinstance(row, dict):
        return False
    if isinstance(row.get("taxonomy_dimensions"), dict):
        return True
    return any(row.get(k) is not None for k in (
        "clinical_score",
        "financial_score",
        "corporate_score",
        "market_access_score",
    ))


def _enrich_importance_only(row: dict[str, Any]) -> bool:
    """If we already have event_ids, attach thermometer_importance without full reclassify."""
    dims = row.get("taxonomy_dimensions")
    if not isinstance(dims, dict) or not dims:
        return False
    try:
        from catalyst_benchmark import importance_for_taxonomy, match_benchmark_event
    except Exception:
        return False
    changed = False
    blob = _text_blob(row)
    for dim, block in dims.items():
        if not isinstance(block, dict) or block.get("unclassified"):
            continue
        tid = str(block.get("event_id") or "").strip()
        if not tid:
            continue
        ev_txt = " ".join(
            str(x)
            for x in (block.get("evidence"), block.get("event_type"), blob[:800])
            if x
        )
        try:
            imp = importance_for_taxonomy(tid, text=ev_txt)
        except Exception:
            imp = None
        if imp is None:
            continue
        if block.get("thermometer_importance") != int(imp):
            block["thermometer_importance"] = int(imp)
            changed = True
        try:
            hit = match_benchmark_event(
                ev_txt or tid,
                taxonomy_event_id=tid,
                min_score=0.45 if ev_txt else 0.99,
            )
            if hit:
                if block.get("benchmark_label") != hit.get("label"):
                    block["benchmark_label"] = hit.get("label")
                    changed = True
                if block.get("benchmark_id") != hit.get("id"):
                    block["benchmark_id"] = hit.get("id")
                    changed = True
        except Exception:
            pass
    return changed


def _rescore_row(row: dict[str, Any], *, force_full: bool) -> tuple[bool, str]:
    """
    Returns (changed, mode) where mode is 'full' | 'importance' | 'skip'.
    """
    if not _has_taxonomy_payload(row) and not force_full:
        # Still try nested brief
        brief = row.get("brief")
        if isinstance(brief, dict) and _has_taxonomy_payload(brief):
            ch, mode = _rescore_row(brief, force_full=force_full)
            return ch, mode
        return False, "skip"

    blob = _text_blob(row)
    title = str(
        row.get("title")
        or row.get("headline")
        or row.get("event_title")
        or row.get("summary_10w")
        or ""
    ).strip()

    # Prefer full re-score when we have enough text
    if len(blob) >= 12 or len(title) >= 8:
        try:
            from daily_news_desk import _dimension_scores

            scored = _dimension_scores(title or blob[:200], blob)
        except Exception as exc:
            # Fallback: importance-only
            if _enrich_importance_only(row):
                return True, "importance"
            return False, f"err:{exc}"[:80]

        changed = False
        for k in DIM_KEYS:
            if k not in scored:
                continue
            # Always rewrite taxonomy_* and dimension scores on backfill
            if row.get(k) != scored.get(k):
                changed = True
            row[k] = scored.get(k)
        # Keep news_kind aligned with winning dim when present
        tdims = row.get("taxonomy_dimensions") or {}
        if isinstance(tdims, dict):
            if (tdims.get("financial") or {}).get("event_id"):
                if row.get("news_kind") != "financial":
                    row["news_kind"] = "financial"
                    changed = True
            elif (tdims.get("clinical") or {}).get("event_id"):
                if row.get("news_kind") not in ("clinical", "press"):
                    row["news_kind"] = "clinical"
                    changed = True
        row["thermometer_backfilled_at"] = datetime.now(timezone.utc).isoformat()
        return True, "full"

    # Thin text: keep classification, attach Excel importance
    if _enrich_importance_only(row):
        row["thermometer_backfilled_at"] = datetime.now(timezone.utc).isoformat()
        return True, "importance"
    return False, "skip"


def _walk_and_rescore(obj: Any, stats: dict[str, int], *, force_full: bool) -> None:
    if isinstance(obj, dict):
        if _has_taxonomy_payload(obj) or (
            isinstance(obj.get("brief"), dict)
            and _has_taxonomy_payload(obj["brief"])
        ):
            stats["seen"] += 1
            ch, mode = _rescore_row(obj, force_full=force_full)
            if ch:
                stats["changed"] += 1
                stats[f"mode_{mode}"] = stats.get(f"mode_{mode}", 0) + 1
            else:
                stats[f"mode_{mode}"] = stats.get(f"mode_{mode}", 0) + 1
        for v in obj.values():
            _walk_and_rescore(v, stats, force_full=force_full)
    elif isinstance(obj, list):
        for x in obj:
            _walk_and_rescore(x, stats, force_full=force_full)


def _backup(path: Path) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bak = path.with_suffix(path.suffix + f".bak_{ts}")
    shutil.copy2(path, bak)
    return bak


def backfill_file(path: Path, *, dry_run: bool, force_full: bool) -> dict[str, Any]:
    if not path.is_file():
        return {"ok": False, "path": str(path), "error": "missing"}
    doc = json.loads(path.read_text(encoding="utf-8"))
    stats: dict[str, int] = {"seen": 0, "changed": 0}
    _walk_and_rescore(doc, stats, force_full=force_full)
    out: dict[str, Any] = {
        "ok": True,
        "path": str(path),
        "dry_run": dry_run,
        **stats,
    }
    if dry_run:
        return out
    if stats["changed"]:
        bak = _backup(path)
        path.write_text(
            json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        out["backup"] = str(bak)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--force-full",
        action="store_true",
        default=True,
        help="Always run score_article_dimensions when text exists (default on)",
    )
    ap.add_argument(
        "--root",
        default=str(ROOT),
        help="Repo /opt/biotech root",
    )
    args = ap.parse_args()
    root = Path(args.root)
    targets = [
        root / "data" / "cache" / "daily_news_desk.json",
        root / "data" / "clinical_pre_cd_enrichment_snapshot.json",
    ]
    results = []
    for p in targets:
        print(f"[backfill] {p} …", flush=True)
        r = backfill_file(p, dry_run=args.dry_run, force_full=bool(args.force_full))
        results.append(r)
        print(json.dumps(r, indent=2), flush=True)

    # Summary importance coverage
    try:
        from catalyst_benchmark import clear_catalyst_benchmark_cache

        clear_catalyst_benchmark_cache()
    except Exception:
        pass
    print("[backfill] done", flush=True)
    return 0 if all(r.get("ok") for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
