import csv

targets = {"ANIK": "2026-05-31", "CNSP": "2026-05-27", "IRWD": "2026-05-31", "VYGR": "2026-06-22"}
found = {}
with open("data/biotech_clinical_openfda.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        tk = row.get("ticker", "").strip().upper()
        if tk in targets:
            cd  = row.get("completion_date", "")
            nct = row.get("nct_id", "")
            src = row.get("source", "")
            pcd = row.get("primary_completion_date", "")
            if cd == targets[tk]:
                print(f"FOUND  {tk}: nct={nct}  cd={cd}  pcd={pcd}  src={src}")
                found[tk] = True
for tk in targets:
    if tk not in found:
        print(f"MISSING {tk}: no row with cd={targets[tk]}")
