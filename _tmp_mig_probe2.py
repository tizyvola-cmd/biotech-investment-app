from collections import Counter
from daily_news_desk import _read, migrate_daily_news_to_eis

doc = _read()
items = [i for i in (doc.get("items") or []) if isinstance(i, dict)]
top = [i for i in (doc.get("top_news") or []) if isinstance(i, dict)]
print("items", len(items), "top_news", len(top))
print("item status", Counter(str(i.get("status")) for i in items))
print(
    "flags",
    "migrated",
    sum(1 for i in items if i.get("migrated_to_eis")),
    "dismissed",
    sum(1 for i in items if i.get("dismissed")),
)
staged = [i for i in items if i.get("status") == "staged" and not i.get("dismissed")]
print("staged pending", len(staged))
visible = [
    i
    for i in items
    if not i.get("migrated_to_eis")
    and not i.get("dismissed")
    and str(i.get("status") or "").lower() not in {"migrated", "dismissed"}
]
print("ui-visible-ish", len(visible))
print(
    "status of visible",
    Counter(str(i.get("status")) for i in visible),
)

iid = "c92d164538ecade7"
row = next((i for i in items if str(i.get("id")) == iid), None)
print("azn row", None if not row else {k: row.get(k) for k in ("id", "status", "migrated_to_eis", "dismissed", "ticker")})
out = migrate_daily_news_to_eis(item_id=iid)
print("azn migrate", {k: out.get(k) for k in ("ok", "migrated", "error", "reason")})

# sample non-staged visible
for i in visible[:8]:
    print(
        "vis",
        i.get("status"),
        i.get("ticker"),
        str(i.get("id"))[:12],
        str(i.get("title"))[:50],
    )
