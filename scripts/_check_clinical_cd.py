import csv

targets = {
    "CNSP":  ("NCT04602624", "2026-05-27"),
    "ANIK":  ("NCT04640298", "2026-05-31"),
    "HURA":  ("NCT06940440", "2026-05-31"),
    "IRWD":  ("NCT00948818", "2026-05-31"),
    "CLRB":  ("NCT02952508", "2026-06-22"),
    "PBYI":  ("NCT04886531", "2026-06-22"),
    "VYGR":  ("NCT00231946", "2026-06-22"),
    "AGIO":  ("NCT07055243", "2026-06-30"),
    "BCAB":  ("NCT04918186", "2026-06-30"),
    "ENGNW": ("NCT04752722", "2026-06-30"),
    "IBRX":  ("NCT04340596", "2026-06-30"),
    "KPTI":  ("NCT02436707", "2026-06-30"),
    "OLMA":  ("NCT06016738", "2026-06-30"),
    "PLSE":  ("NCT07287176", "2026-06-30"),
    "SVA":   ("NCT07418229", "2026-06-30"),
    "TELA":  ("NCT05736848", "2026-06-30"),
}

found = {}
with open("data/biotech_clinical_openfda.csv", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        tk  = row.get("ticker", "").strip().upper()
        nct = row.get("nct_id", "").strip().upper()
        if tk in targets and nct == targets[tk][0]:
            if tk not in found:
                sim_cd  = targets[tk][1]
                csv_cd  = row.get("completion_date", "")
                csv_pcd = row.get("primary_completion_date", "")
                match_cd  = "CD_OK"  if csv_cd  == sim_cd else "CD_NO"
                match_pcd = "PCD_OK" if csv_pcd == sim_cd else "PCD_NO"
                print(f"{tk:6}  csv_cd={csv_cd!r:22}  pcd={csv_pcd!r:22}  sim={sim_cd}  {match_cd} {match_pcd}")
                found[tk] = True

missing = set(targets) - set(found)
if missing:
    print(f"\nNon trovati nel CSV con NCT atteso: {sorted(missing)}")
