"""Campiona record per fascia affidabilita per capire il pattern anomalo."""
import json, sys, io, os, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "data/past_catalyst_predictions.json"), encoding="utf-8") as f:
    doc = json.load(f)
raw = doc.get("rows", {})
rows = list(raw.values()) if isinstance(raw, dict) else list(raw)

def has_actual(r):
    for k in ("d3_pct","d5_pct","d3_actual","d5_actual"):
        if r.get(k) is not None: return True
    return False

all_rows = [r for r in rows if has_actual(r)]

def get_actual(r):
    for k in ("d3_pct","d5_pct","d3_actual","d5_actual"):
        v = r.get(k)
        if v is not None:
            try: return float(v)
            except: pass
    return None

# ── Cerca record con aff=30-49 E direzionali ─────────────────────────────────
bad = [r for r in all_rows
       if 30 <= int(r.get("affidabilita", 0)) <= 49
       and str(r.get("dir_v4") or r.get("direction","")).startswith(("↑","↓"))]

print(f"Aff=30-49 + direzionale: {len(bad)} records")
print("\nCampione 10 record:")
for r in bad[:10]:
    aff  = r.get("affidabilita")
    d    = str(r.get("dir_v4") or r.get("direction",""))[:20]
    a3   = r.get("d3_pct")
    a5   = r.get("d5_pct")
    inp  = r.get("model_inputs_present_n")
    ok   = r.get("ok_v4")
    star = r.get("stars")
    tk   = r.get("ticker","")
    cd   = r.get("completion_date","")
    print(f"  {tk:6} {cd}  aff={aff:3}  dir={d!r:22}  d3={str(a3)[:7]}  d5={str(a5)[:7]}  inputs={inp}  ok_v4={ok}  stars={star}")

# ── Cerca record con aff=65-79 per contrasto ─────────────────────────────────
good = [r for r in all_rows
        if 65 <= int(r.get("affidabilita", 0)) <= 79
        and str(r.get("dir_v4") or r.get("direction","")).startswith(("↑","↓"))]

print(f"\nAff=65-79 + direzionale: {len(good)} records")
print("\nCampione 10 record:")
for r in good[:10]:
    aff  = r.get("affidabilita")
    d    = str(r.get("dir_v4") or r.get("direction",""))[:20]
    a3   = r.get("d3_pct")
    a5   = r.get("d5_pct")
    inp  = r.get("model_inputs_present_n")
    ok   = r.get("ok_v4")
    tk   = r.get("ticker","")
    cd   = r.get("completion_date","")
    print(f"  {tk:6} {cd}  aff={aff:3}  dir={d!r:22}  d3={str(a3)[:7]}  d5={str(a5)[:7]}  inputs={inp}  ok_v4={ok}")

# ── Verifica: forse ok_v4 è storato e diverso dal mio calcolo? ───────────────
print("\n--- Verifica ok_v4 storato nei record direzionali ---")
ok_stored_present = [r for r in all_rows if r.get("ok_v4") is not None and
                     str(r.get("dir_v4") or r.get("direction","")).startswith(("↑","↓"))]
print(f"Records direzionali con ok_v4 storato: {len(ok_stored_present)}")
if ok_stored_present:
    for r in ok_stored_present[:5]:
        print(f"  ok_v4={r.get('ok_v4')}  dir={str(r.get('dir_v4') or r.get('direction',''))[:20]}  d3={r.get('d3_pct')}  aff={r.get('affidabilita')}")

# ── Il campione aff=0 con stabile ma grandi movimenti ─────────────────────────
print("\n--- Aff=0 stabile con grande movimento ---")
big_stab = [r for r in all_rows
            if r.get("affidabilita",0) == 0
            and str(r.get("dir_v4") or r.get("direction","")).startswith("→")
            and abs(get_actual(r) or 0) > 10]
print(f"Aff=0, Stabile, |actual|>10%: {len(big_stab)}")
for r in big_stab[:5]:
    print(f"  {r.get('ticker','')} {r.get('completion_date','')}  actual={get_actual(r):.1f}%  dir={str(r.get('dir_v4') or r.get('direction',''))[:20]}")

# ── Distribuzione affidabilita valori (aff>0, solo direzionali) ───────────────
print("\n--- Distribuzione valori affidabilita (direzionali, aff>0) ---")
aff_dir_vals = collections.Counter(r.get("affidabilita") for r in all_rows
                if r.get("affidabilita",0) > 0
                and str(r.get("dir_v4") or r.get("direction","")).startswith(("↑","↓")))
print("I 20 valori più comuni:", aff_dir_vals.most_common(20))
