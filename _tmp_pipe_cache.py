from product_briefing_lookup import (
    _find_pipeline_cache_entry,
    _load_pipeline_cache,
    _pipeline_cache_key,
)

a = _pipeline_cache_key("REGN", ["a"])
b = _pipeline_cache_key("REGN", ["b"])
print("keys", a, b, a == b)
d = _load_pipeline_cache()
print("entries", len(d.get("entries") or {}))
h = _find_pipeline_cache_entry(d, "REGN")
print("regn hit", bool(h), (h or {}).get("updated_at"), len((h or {}).get("products") or []))
