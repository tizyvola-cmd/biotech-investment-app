"""
Diagnostics: for each ticker in the sim catalog (CD within 60 days),
find the matching clinical row and verify:
  - is the NCT the same as in the sim table?
  - which date column matched (cd vs primary_completion_date)?
  - is the final completion_date far in the future (misleading)?
"""
import json, re, sys, io
from datetime import date

# Force UTF-8 output so Unicode chars don't crash on Windows cp1252
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

TODAY = date(2026, 5, 24)
MAX_DAYS = 60

import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_json(rel):
    path = os.path.join(ROOT, rel)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"WARN cannot load {path}: {e}", file=sys.stderr)
        return {}

snap = load_json("data/clinical_simulation_snapshot.json")
sim  = load_json("data/simulation_sheet_snapshot.json")

def parse_iso(v):
    """Parse ISO (2026-05-27) or Italian (27/05/2026) date strings."""
    if not v: return None
    s = str(v).strip()
    # ISO
    if len(s) >= 10 and s[4] == "-":
        try: return date.fromisoformat(s[:10])
        except: pass
    # Italian dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
    import re as _re
    m = _re.match(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$", s)
    if m:
        dd, mm, yyyy = m.groups()
        try: return date(int(yyyy), int(mm), int(dd))
        except: pass
    return None

def days_to(d):
    return (d - TODAY).days if d else None

def extract_nct(v):
    if isinstance(v, dict):
        v = v.get("text") or v.get("href") or ""
    s = str(v or "").upper().replace(" ", "")
    m = re.search(r"NCT\d{8,}", s)
    return m.group(0) if m else None

# ── Inspect sim columns ───────────────────────────────────────────────────────
sim_rows = sim.get("rows", [])
print(f"Sim snapshot rows: {len(sim_rows)}")
if sim_rows:
    # Find the key that holds company name / NCT / CD
    sample = sim_rows[0]
    print("Sim columns:", [k for k in sample.keys() if sample[k]])

print()

# ── Build sim catalog ─────────────────────────────────────────────────────────
by_ticker = {}
for r in sim_rows:
    # Try common ticker key names
    tk = str(r.get("Ticker") or r.get("ticker") or r.get("Symbol") or "").strip().upper()
    if not tk or len(tk) > 6:
        continue
    by_ticker.setdefault(tk, []).append(r)

catalog = {}
for tk, rows in by_ticker.items():
    best = None; best_days = None
    for r in rows:
        cd_val = r.get("Completion Date") or r.get("completion_date")
        d = parse_iso(cd_val)
        if not d: continue
        dd = days_to(d)
        if dd is None or dd < 0 or dd > MAX_DAYS: continue
        if best_days is None or dd < best_days:
            best = r; best_days = dd
    if best:
        cd_val = best.get("Completion Date") or best.get("completion_date")
        nct_raw = best.get("NCT") or best.get("nct") or best.get("Link studio") or ""
        sim_nct = extract_nct(nct_raw)
        company = str(
            best.get("Societa") or best.get("Società") or best.get("Nome") or
            best.get("Company") or best.get("company") or ""
        ).strip()
        # Convert to ISO format for comparison with snapshot dates
        cd_iso = d.isoformat()  # d is the parsed date object from the loop
        catalog[tk] = {
            "cd": cd_iso,
            "nct": sim_nct,
            "days": best_days,
            "company": company,
        }

print(f"Sim catalog tickers ({len(catalog)}): {sorted(catalog.keys())}")
print()

# ── Match against clinical snapshot ──────────────────────────────────────────
HDR = (
    f"{'Ticker':<7} {'Sim-CD':<12} {'Sim-NCT':<14}"
    f"{'Clin-NCT':<14} {'clin-cd':<12} {'clin-pcd':<12}"
    f"{'MatchOn':<10} {'SameStudy':<11} WARNING"
)
print(HDR)
print("-" * 115)

issues = []

for tk in sorted(catalog.keys()):
    cat     = catalog[tk]
    sim_cd  = cat["cd"]
    sim_nct = cat["nct"]

    matched_rows = []
    for row in snap.get("rows", []):
        rtk = str(row.get("ticker") or "").upper()
        if rtk != tk:
            continue
        nid     = row.get("nct_id") or ""
        row_nct = extract_nct(nid)

        cd  = str(row.get("completion_date") or "").strip()
        pcd = str(row.get("primary_completion_date") or "").strip()
        ecd = str(row.get("estimated_completion_date") or "").strip()
        row_dates = {d[:10] for d in [cd, pcd, ecd] if d and len(d) >= 7}

        if sim_cd not in row_dates:
            continue
        # NCT filter
        if sim_nct and row_nct and sim_nct != row_nct:
            continue

        if cd[:10] == sim_cd:
            matched_on = "cd"
        elif pcd[:10] == sim_cd:
            matched_on = "primary_cd"
        else:
            matched_on = "est_cd"

        nct_same = (
            "YES"    if (sim_nct and row_nct and sim_nct == row_nct) else
            "sim=?"  if not sim_nct else
            "clin=?" if not row_nct else
            "NO"
        )

        final_cd_date  = parse_iso(cd)
        far_future = (final_cd_date and days_to(final_cd_date) > MAX_DAYS) if final_cd_date else False

        warn = ""
        if nct_same == "NO":
            warn = "!!! DIFFERENT NCT"
        elif nct_same == "sim=?":
            warn = "sim table has no NCT — match by date+ticker only"
        elif far_future and matched_on != "cd":
            warn = f"displayed cd={cd[:10]} is FINAL (study end), primary_cd={pcd[:10]} is the catalyst"

        matched_rows.append({
            "row_nct": row_nct or "None",
            "cd":  cd[:10] if cd else "None",
            "pcd": pcd[:10] if pcd else "None",
            "matched_on": matched_on,
            "nct_same": nct_same,
            "warn": warn,
        })

    if not matched_rows:
        print(f"{tk:<7} {sim_cd:<12} {str(sim_nct or '?'):<14}  NO MATCH IN SNAPSHOT")
        issues.append(f"{tk}: no match in snapshot")
        continue

    for mr in matched_rows:
        print(
            f"{tk:<7} {sim_cd:<12} {str(sim_nct or '?'):<14}"
            f"{mr['row_nct']:<14} {mr['cd']:<12} {mr['pcd']:<12}"
            f"{mr['matched_on']:<10} {mr['nct_same']:<11} {mr['warn']}"
        )
        if "!!!" in mr["warn"]:
            issues.append(f"{tk}: {mr['warn']}")

print()
print(f"=== Issues found: {len(issues)} ===")
for iss in issues:
    print(f"  - {iss}")
