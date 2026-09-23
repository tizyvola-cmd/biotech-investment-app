#!/usr/bin/env python3
"""Re-score stock-tape items that parked CLIN_* under corporate."""
from __future__ import annotations

import json
from pathlib import Path

from eis_taxonomy_scoring import (
    _postprocess_dimension_hits,
    classification_to_score_fields,
    _is_stock_tape_market_wrap,
)

PATH = Path("/opt/biotech/data/cache/daily_news_desk.json")


def _fix_row(row: dict) -> bool:
    dims = row.get("taxonomy_dimensions")
    if not isinstance(dims, dict):
        return False
    title = str(row.get("title") or "")
    body = " ".join(
        str(row.get(k) or "")
        for k in (
            "summary_10w",
            "summary_long",
            "detail_summary",
            "taxonomy_audit",
        )
    )
    blob = f"{title}\n{body}"
    # Always reconcile misplaced CLIN_* ; stock-tape suppress when applicable.
    classified = {
        "dimensions": {
            d: dict(dims.get(d) or {})
            for d in ("clinical", "financial", "corporate", "market_access")
        },
        "classification_method": row.get("taxonomy_method") or "ai",
        "review_flags": [],
        "taxonomy_version": None,
    }
    fixed_dims = _postprocess_dimension_hits(classified["dimensions"], blob)
    scored = classification_to_score_fields({**classified, "dimensions": fixed_dims})
    changed = False
    for k in (
        "clinical_score",
        "financial_score",
        "corporate_score",
        "market_access_score",
        "taxonomy_dimensions",
        "taxonomy_audit",
        "eis_score",
        "eis",
    ):
        if scored.get(k) is not None or k in row:
            if row.get(k) != scored.get(k):
                row[k] = scored.get(k)
                changed = True
    if _is_stock_tape_market_wrap(blob):
        clin_id = ((row.get("taxonomy_dimensions") or {}).get("clinical") or {}).get(
            "event_id"
        )
        if not clin_id and row.get("news_kind") in (None, "other", "clinical"):
            if row.get("news_kind") != "financial":
                row["news_kind"] = "financial"
                changed = True
    return changed


def main() -> None:
    doc = json.loads(PATH.read_text(encoding="utf-8"))
    n = 0
    for section in ("items", "highlights", "top_news"):
        rows = doc.get(section) or []
        if not isinstance(rows, list):
            continue
        for row in rows:
            if isinstance(row, dict) and _fix_row(row):
                n += 1
                print("fixed:", (row.get("ticker"), (row.get("title") or "")[:70]))
    if n:
        PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print("updated_rows", n)


if __name__ == "__main__":
    main()
