import daily_news_desk as dnd

doc = dnd._read()
hits = []
for bucket in ("items", "top_news", "highlights"):
    for r in doc.get(bucket) or []:
        if str(r.get("ticker", "")).upper() != "GRAL":
            continue
        hits.append(
            {
                "bucket": bucket,
                "source_kind": r.get("source_kind"),
                "title": (r.get("title") or "")[:80],
                "clinical_score": r.get("clinical_score"),
                "panel_qa": len(r.get("panel_qa") or []),
                "company_summary": bool(r.get("company_summary")),
                "product_inset": bool(r.get("product_inset")),
                "fda_stance": r.get("fda_stance"),
                "tax": ((r.get("taxonomy_dimensions") or {}).get("clinical") or {}).get(
                    "score"
                ),
            }
        )
print("n", len(hits))
for h in hits[:6]:
    print(h)
