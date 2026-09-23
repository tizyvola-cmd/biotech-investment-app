import json
from pathlib import Path
from eis_taxonomy_scoring import score_article_dimensions
from daily_news_desk import _dimension_scores, _provisional_eis, _headline_sentiment

doc = json.loads(Path("data/cache/daily_news_desk.json").read_text(encoding="utf-8"))
items = list(doc.get("top_news") or []) + list(doc.get("manual_news") or []) + list(doc.get("highlights") or [])
# also nested
for k in sorted(doc.keys()):
    v = doc[k]
    if isinstance(v, list) and v and isinstance(v[0], dict) and ("title" in v[0] or "eis_score" in v[0]):
        print("list key", k, "n", len(v))
print("top keys", list(doc.keys())[:30])
bntx = [i for i in items if str(i.get("ticker") or "").upper() == "BNTX" or "BNTX" in str(i.get("title") or "").upper() or "BioNTech" in str(i.get("title") or "")]
print("bntx-ish from flat", len(bntx))
# walk all lists
all_items = []
for k,v in doc.items():
    if isinstance(v, list):
        for it in v:
            if isinstance(it, dict) and (it.get("title") or it.get("url")):
                all_items.append((k, it))
print("all newsish", len(all_items))
for k,it in all_items:
    title = str(it.get("title") or "")[:80]
    if "BNTX" in title.upper() or "biontech" in title.lower() or str(it.get("ticker","")).upper()=="BNTX":
        print("---", k)
        print("title:", title)
        print("eis_score", it.get("eis_score"), "clin", it.get("clinical_score"), "fin", it.get("financial_score"), "corp", it.get("corporate_score"), "acc", it.get("market_access_score"))
        print("eis obj", it.get("eis"))
        blob = f"{it.get('title') or ''} {it.get('summary') or it.get('summary_long') or ''}"
        print("sentiment", _headline_sentiment(blob))
        print("provisional", _provisional_eis(str(it.get("title") or ""), str(it.get("summary") or "")))
        scored = score_article_dimensions(blob, use_ai=False)
        print("taxonomy eis", scored.get("eis_score"), "dims", {x: scored.get(x) for x in ("clinical_score","financial_score","corporate_score","market_access_score")})
        print("method", scored.get("taxonomy_method"), "dims hit", scored.get("taxonomy_dimensions"))
