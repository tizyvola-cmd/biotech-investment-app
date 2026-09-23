"""Smoke-check taxonomy scoring on curated + cached Daily News rows."""
from __future__ import annotations

import json
from pathlib import Path

from eis_taxonomy_scoring import score_article_dimensions

CURATED = [
    ("CRL", "FDA issued a Complete Response Letter for the NDA of DrugX after manufacturing issues."),
    ("PRIMARY+", "Phase 3 pivotal trial met the primary endpoint with statistical significance (p<0.001)."),
    ("PRIMARY-", "The Phase 2 study failed to meet the primary endpoint."),
    ("OFFERING", "Company priced a public offering of common stock, raising gross proceeds of $75M."),
    ("SHELF", "Company filed a shelf registration statement; no shares were offered."),
    ("MA", "Buyer agreed to acquire Target for $1.2B in cash via tender offer."),
    ("LICENSE", "Parties signed a licensing agreement with a $40M upfront payment and milestones."),
    ("FORMULARY", "Payers added DrugX to the commercial formulary effective Q3."),
    ("NICE-", "NICE decided not to recommend the therapy for routine NHS use."),
    ("BTD", "FDA granted Breakthrough Therapy Designation for DrugX in rare disease."),
    ("RUNWAY", "Cash runway extended into 2028 following the financing."),
    ("HOLD", "FDA placed a clinical hold; trial was paused following a safety signal."),
]


def main() -> None:
    for name, text in CURATED:
        s = score_article_dimensions(text, use_ai=False)
        dims = s["taxonomy_dimensions"]
        hits = {
            k: {
                "event": v.get("event_type"),
                "score": v.get("score"),
                "ev": v.get("evidence"),
            }
            for k, v in dims.items()
            if v.get("event_id")
        }
        print(
            f"--- {name} clin={s['clinical_score']} fin={s['financial_score']} "
            f"corp={s['corporate_score']} acc={s['market_access_score']} eis={s['eis_score']}"
        )
        for k, h in hits.items():
            print(" ", k, h)

    a = "met the primary endpoint with statistical significance (p<0.001) in Phase 3"
    b = "In Phase 3, met the primary endpoint with statistical significance (p<0.001)"
    sa = score_article_dimensions(a, use_ai=False)
    sb = score_article_dimensions(b, use_ai=False)
    print(
        "REPRO",
        sa["clinical_score"],
        sb["clinical_score"],
        sa["clinical_score"] == sb["clinical_score"],
    )

    cache = Path("data/cache/daily_news_desk.json")
    unclassified = []
    if cache.exists():
        doc = json.loads(cache.read_text(encoding="utf-8"))
        n = 0
        for key in ("items", "top_news", "user_analyses", "highlights"):
            for it in doc.get(key) or []:
                if not isinstance(it, dict):
                    continue
                title = str(it.get("title") or it.get("summary_10w") or "")
                body = str(
                    it.get("summary")
                    or it.get("summary_long")
                    or it.get("source_excerpt")
                    or ""
                )
                blob = f"{title} {body}".strip()
                if len(blob) < 40:
                    continue
                s = score_article_dimensions(blob, use_ai=False)
                hits = [
                    (k, v.get("event_type"), v.get("score"))
                    for k, v in (s.get("taxonomy_dimensions") or {}).items()
                    if v.get("event_id")
                ]
                tk = it.get("ticker") or "?"
                sk = it.get("source_kind")
                if not hits:
                    unclassified.append((tk, title[:70], sk))
                print(f"CACHE {tk} [{sk}] hits={hits or 'NONE'} | {title[:70]}")
                n += 1
                if n >= 15:
                    break
            if n >= 15:
                break
    print("UNCLASSIFIED", len(unclassified))
    for u in unclassified:
        print(" ", u)


if __name__ == "__main__":
    main()
