from daily_news_desk import _read, migrate_daily_news_to_eis
import time

doc = _read()
items = [
    i
    for i in (doc.get("items") or [])
    if isinstance(i, dict)
    and not i.get("migrated_to_eis")
    and not i.get("dismissed")
]
print("pending", len(items))
if not items:
    raise SystemExit(0)
iid = str(items[0].get("id") or "")
print("id", iid)
print("title", str(items[0].get("title") or "")[:80])
t0 = time.time()
out = migrate_daily_news_to_eis(item_id=iid)
print("elapsed", round(time.time() - t0, 2))
print({k: out.get(k) for k in ("ok", "migrated", "error", "skipped_no_record", "calendar_dates")})
