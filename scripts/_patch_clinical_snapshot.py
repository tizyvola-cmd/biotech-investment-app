"""
Aggiunge al clinical_simulation_snapshot.json le righe per i 4 ticker
che non matchano (CNSP, ANIK, IRWD, VYGR) con i NCT esatti della sim table.
"""
import json, urllib.request, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "clinical_simulation_snapshot.json")

CT_API = "https://clinicaltrials.gov/api/v2/studies/{nct}"

NEED = [
    {"ticker": "CNSP",  "nct": "NCT04602624", "cd": "2026-05-27", "company": "CNS Pharmaceuticals, Inc.",       "sponsor_rel": "correlated company/subsidiary"},
    {"ticker": "ANIK",  "nct": "NCT04640298", "cd": "2026-05-31", "company": "Anika Therapeutics, Inc.",        "sponsor_rel": "direct sponsor"},
    {"ticker": "IRWD",  "nct": "NCT00948818", "cd": "2026-05-31", "company": "Ironwood Pharmaceuticals, Inc.",  "sponsor_rel": "correlated company/subsidiary"},
    {"ticker": "VYGR",  "nct": "NCT00231946", "cd": "2026-06-22", "company": "Voyager Therapeutics, Inc.",      "sponsor_rel": "correlated company/subsidiary"},
]

def fetch(nct):
    try:
        req = urllib.request.Request(CT_API.format(nct=nct), headers={"User-Agent": "SuperNova/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read())
        p = d.get("protocolSection", {})
        ident  = p.get("identificationModule", {})
        status = p.get("statusModule", {})
        design = p.get("designModule", {})
        return {
            "brief_title":    ident.get("briefTitle", ""),
            "official_title": ident.get("officialTitle", ""),
            "overall_status": status.get("overallStatus", ""),
            "study_type":     design.get("studyType", ""),
            "phase":          " | ".join(design.get("phases", [])),
        }
    except Exception as e:
        print(f"  WARN {nct}: {e}", file=sys.stderr)
        return {}

with open(SNAP, encoding="utf-8") as f:
    snap = json.load(f)

existing_keys = {
    (str(r.get("ticker", "")).upper(),
     (r["nct_id"]["text"] if isinstance(r.get("nct_id"), dict) else str(r.get("nct_id",""))).upper())
    for r in snap.get("rows", [])
}

print(f"Snapshot: {snap.get('row_count')} righe, {len(existing_keys)} (ticker,nct) unici")

added = []
for entry in NEED:
    tk  = entry["ticker"].upper()
    nct = entry["nct"].upper()
    if (tk, nct) in existing_keys:
        print(f"  SKIP {tk}/{nct} già presente")
        continue
    print(f"  FETCH {tk}/{nct} ...", end=" ", flush=True)
    ct = fetch(nct)
    row = {
        "source":        "clinicaltrials",
        "ticker":        tk,
        "query_company": entry["company"],
        "nct_id":        {"text": nct, "href": f"https://clinicaltrials.gov/study/{nct}"},
        "brief_title":   ct.get("brief_title", ""),
        "official_title": ct.get("official_title", ""),
        "overall_status": ct.get("overall_status", ""),
        "study_type":    ct.get("study_type", ""),
        "phase":         ct.get("phase", ""),
        "completion_date": entry["cd"],     # ← CD della sim table
        "sponsor_match": entry["sponsor_rel"],
    }
    added.append(row)
    print(f"OK [{ct.get('overall_status','?')}]  {ct.get('brief_title','')[:60]}")

if not added:
    print("Nessuna riga nuova.")
    sys.exit(0)

snap["rows"] = snap.get("rows", []) + added
snap["row_count"] = len(snap["rows"])

with open(SNAP, "w", encoding="utf-8") as f:
    json.dump(snap, f, ensure_ascii=False, indent=None, separators=(",", ":"))

print(f"\nSnapshot aggiornato: +{len(added)} righe → {snap['row_count']} totali")
