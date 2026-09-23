import json
from pathlib import Path

out = []

p = Path("data/simulation_sheet_snapshot.json")
if p.is_file():
    snap = json.loads(p.read_text(encoding="utf-8"))
    for r in snap.get("rows") or []:
        tk = str(r.get("Ticker") or r.get("ticker") or "").upper()
        if tk != "ETON":
            continue
        out.append("=== simulation_sheet ETON ===")
        for k, v in r.items():
            if not v:
                continue
            kl = k.lower()
            if any(x in kl for x in ("nct", "sponsor", "complet", "title", "phase", "ticker", "company")):
                out.append(f"{k}: {str(v)[:200]}")
else:
    out.append("simulation_sheet_snapshot MISSING")

p = Path("data/clinical_simulation_snapshot.json")
if p.is_file():
    snap = json.loads(p.read_text(encoding="utf-8"))
    hits = []
    for r in snap.get("rows") or []:
        nct = str(r.get("nct_id") or "")
        tk = str(r.get("ticker") or "").upper()
        if tk == "ETON" or "04585750" in nct:
            hits.append(
                {
                    "ticker": tk,
                    "nct_id": nct,
                    "sponsor_match": r.get("sponsor_match"),
                    "query_company": r.get("query_company"),
                    "lead_sponsor": r.get("lead_sponsor"),
                    "brief_title": str(r.get("brief_title") or "")[:80],
                }
            )
    out.append(f"=== clinical_simulation hits {len(hits)} ===")
    for h in hits[:30]:
        out.append(str(h))
else:
    out.append("clinical_simulation_snapshot MISSING")

Path("_tmp_eton_trace_out.txt").write_text("\n".join(out), encoding="utf-8")
print("wrote", len(out), "lines")
