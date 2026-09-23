from daily_news_desk import _read, persist_brief_cache, _article_fingerprint
import fda_adcom_briefing as fab
import fda_adcom_calendar as fac

snap = fac.load_snapshot()
row = next(r for r in snap["rows"] if r.get("id") == "2026-09-16-LGND")
card = row["briefing"]
brief = fab.card_to_daily_news_brief(row, card)
print("detail_len", len(brief.get("detail_summary") or ""))
print("has_exec", "FAERS" in (brief.get("detail_summary") or ""))
print("insight_start", (brief.get("investor_insight") or "")[:180])
# Persist into desk brief cache so open-modal hits rich content
doc = _read()
items = [i for i in (doc.get("top_news") or []) if isinstance(i, dict) and i.get("ticker") == "LGND" and i.get("source_kind") == "fda_briefing"]
if items:
    it = items[0]
    fp = str(it.get("article_fp") or "")
    if not fp:
        fp = _article_fingerprint(ticker="LGND", title=it.get("title") or "", url=it.get("link") or "", item_id=it.get("id") or "")
    persist_brief_cache(fp, {**brief, "brief_schema": 3, "article_fp": fp}, item_id=str(it.get("id") or ""))
    print("cached_fp", fp)
else:
    print("no staged LGND row")
