#!/usr/bin/env python3
import json
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "data" / "clinical_pre_cd_enrichment_snapshot.json"
if not p.exists():
    print("SNAPSHOT MISSING")
    raise SystemExit(1)

d = json.loads(p.read_text(encoding="utf-8"))
print("updated_at:", d.get("updated_at"))
print("count:", d.get("count"), "ai_ok:", d.get("ai_ok_count"))
recs = d.get("records") or []
for r in recs[:10]:
    tk = r.get("ticker")
    inds = r.get("clinical_indicators") or []
    evs = r.get("clinical_events") or []
    print(f"--- {tk} inds={len(inds)} events={len(evs)} ai_ok={r.get('ai_ok')}")
    for ind in inds[:3]:
        print("  G:", ind.get("label"), ind.get("value"), ind.get("kpi_type"))
    for ev in evs[:2]:
        title = str(ev.get("title") or "")[:40]
        loc = ev.get("indicators") or []
        print(f"  E {ev.get('source_type')} {title} inds={len(loc)}")
        for ind in loc[:2]:
            print("   ", ind.get("label"), ind.get("value"), ind.get("kpi_type"))

empty_global = sum(1 for r in recs if not (r.get("clinical_indicators") or []))
sec8k_empty = 0
sec8k_with_inds = 0
enroll_only_events = 0
for r in recs:
    for ev in r.get("clinical_events") or []:
        loc = ev.get("indicators") or []
        st = str(ev.get("source_type") or "").lower()
        if st == "sec_8k":
            if loc:
                sec8k_with_inds += 1
            else:
                sec8k_empty += 1
        elif loc and all(
            str(i.get("kpi_type") or "") == "enrollment"
            or "reclut" in str(i.get("label") or "").lower()
            or "recruiting" in str(i.get("label") or "").lower()
            for i in loc
            if isinstance(i, dict)
        ):
            enroll_only_events += 1

print("empty global:", empty_global, "/", len(recs))
print("sec8k empty inds:", sec8k_empty, "sec8k with inds (bug?):", sec8k_with_inds)
print("enroll-only events:", enroll_only_events)
