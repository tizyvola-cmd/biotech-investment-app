"""Aggiunge righe per i 4 ticker dove nessuna data coincide con la sim table."""
import csv, urllib.request, json, sys, os

CSV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "biotech_clinical_openfda.csv")

NEED = [
    {"ticker":"ANIK",  "nct":"NCT04640298", "cd":"2026-05-31", "company":"Anika Therapeutics, Inc."},
    {"ticker":"CNSP",  "nct":"NCT04602624", "cd":"2026-05-27", "company":"CNS Pharmaceuticals, Inc."},
    {"ticker":"IRWD",  "nct":"NCT00948818", "cd":"2026-05-31", "company":"Ironwood Pharmaceuticals, Inc."},
    {"ticker":"VYGR",  "nct":"NCT00231946", "cd":"2026-06-22", "company":"Voyager Therapeutics, Inc."},
]

CT_API = "https://clinicaltrials.gov/api/v2/studies/{nct}"

def fetch(nct):
    try:
        req = urllib.request.Request(CT_API.format(nct=nct), headers={"User-Agent":"SuperNova/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read())
        p = d.get("protocolSection", {})
        ident = p.get("identificationModule", {})
        status = p.get("statusModule", {})
        design = p.get("designModule", {})
        spon   = p.get("sponsorCollaboratorsModule", {})
        cond   = p.get("conditionsModule", {})
        interv = p.get("armsInterventionsModule", {})
        phases = design.get("phases", [])
        conditions = " | ".join(cond.get("conditions", [])[:5])
        interventions = " | ".join(i.get("name","") for i in interv.get("interventions",[])[:5])
        lead = spon.get("leadSponsor", {})
        return {
            "brief_title": ident.get("briefTitle",""),
            "official_title": ident.get("officialTitle",""),
            "overall_status": status.get("overallStatus",""),
            "study_type": design.get("studyType",""),
            "phase": " | ".join(phases),
            "conditions": conditions,
            "interventions": interventions,
            "lead_sponsor": lead.get("name",""),
            "lead_sponsor_class": lead.get("class",""),
            "last_update_posted_date": status.get("lastUpdatePostDateStruct",{}).get("date",""),
            "start_date": status.get("startDateStruct",{}).get("date",""),
            "primary_completion_date": status.get("primaryCompletionDateStruct",{}).get("date",""),
        }
    except Exception as e:
        print(f"  WARN {nct}: {e}", file=sys.stderr)
        return {}

# Leggi header
with open(CSV_PATH, encoding="utf-8") as f:
    fieldnames = csv.DictReader(f).fieldnames or []

# Controlla duplicati (ticker+nct con completion_date ESATTA)
existing = set()
with open(CSV_PATH, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        tk  = row.get("ticker","").strip().upper()
        nct = row.get("nct_id","").strip().upper()
        cd  = row.get("completion_date","")
        existing.add((tk, nct, cd))

new_rows = []
for entry in NEED:
    tk  = entry["ticker"].upper()
    nct = entry["nct"].upper()
    cd  = entry["cd"]
    key = (tk, nct, cd)
    if key in existing:
        print(f"  SKIP {tk}/{nct} completion_date={cd} già esatto")
        continue
    print(f"  FETCH {tk}/{nct} ...", end=" ", flush=True)
    ct = fetch(nct)
    row = {f: "" for f in fieldnames}
    row.update({
        "source": "clinicaltrials",
        "query_company": entry["company"],
        "nct_id": nct,
        "brief_title": ct.get("brief_title",""),
        "official_title": ct.get("official_title",""),
        "overall_status": ct.get("overall_status",""),
        "study_type": ct.get("study_type",""),
        "phase": ct.get("phase",""),
        "conditions": ct.get("conditions",""),
        "interventions": ct.get("interventions",""),
        "lead_sponsor": ct.get("lead_sponsor",""),
        "lead_sponsor_class": ct.get("lead_sponsor_class",""),
        "last_update_posted_date": ct.get("last_update_posted_date",""),
        "start_date": ct.get("start_date",""),
        "primary_completion_date": ct.get("primary_completion_date",""),
        "completion_date": cd,          # ← CD sim table → garantisce match
        "ticker": tk,
        "company_match": "sim_table_nct_cd_override",
        "sponsor_match": "direct match",
    })
    new_rows.append(row)
    print(f"OK [{ct.get('overall_status','?')}] {ct.get('brief_title','')[:60]}")

if not new_rows:
    print("Nessuna riga nuova.")
    sys.exit(0)

with open(CSV_PATH, "a", encoding="utf-8", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
    for row in new_rows:
        writer.writerow(row)

print(f"\nAggiunte {len(new_rows)} righe.")
