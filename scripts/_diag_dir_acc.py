"""Diagnostica accuratezza direzionale: capisce perché hit% è ~49%."""
from __future__ import annotations
import json, os, sys, io
from collections import Counter, defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAST = os.path.join(ROOT, "data", "past_catalyst_predictions.json")

def main():
    with open(PAST, encoding="utf-8") as f:
        doc = json.load(f)
    raw = doc.get("rows", {})
    rows = list(raw.values()) if isinstance(raw, dict) else list(raw)
    print(f"Totale record: {len(rows)}")
    if not rows:
        return
    print(f"Chiavi del primo record (campione):")
    print("  " + ", ".join(sorted(rows[0].keys())))
    print()

    # Distribuzione `dir_v4` / `direction`
    cd = Counter()
    for r in rows:
        d = str(r.get("dir_v4") or r.get("direction") or "")[:4]
        cd[d if d else "<vuoto>"] += 1
    print("Distribuzione direction labels (top 12):")
    for k, v in cd.most_common(12):
        print(f"  {k!r:20s} {v:6d}  ({100*v/len(rows):5.1f}%)")
    print()

    # Quanti record hanno un campo `actual` (per orizzonte)
    for k in ("d3_pct", "d5_pct", "d3_actual", "d5_actual", "actual_5", "actual_3"):
        present = sum(1 for r in rows if r.get(k) is not None)
        print(f"  campo '{k}' presente in {present} record")
    print()

    # Quanti record sono "direzionali" (↑/↓) e con actual usabile
    def has_actual(r):
        for k in ("d3_pct", "d5_pct", "d3_actual", "d5_actual"):
            if r.get(k) is not None:
                return True
        return False

    aff_gt0 = [r for r in rows if int(r.get("affidabilita", 0) or 0) > 0]
    print(f"affidabilita > 0: {len(aff_gt0)}")
    with_actual = [r for r in aff_gt0 if has_actual(r)]
    print(f"  con actual disponibile: {len(with_actual)}")
    dir_records = [
        r for r in with_actual
        if str(r.get("dir_v4") or r.get("direction") or "").startswith(("↑", "↓"))
    ]
    print(f"  con dir = ↑/↓: {len(dir_records)}")
    print()

    # Hit% per fascia days_to_t
    bands = [(-10, 7), (7, 15), (15, 30), (30, 60), (60, 9999)]
    print("Hit% direzionale per fascia days_to_t (T-7 ... T-far):")
    for lo, hi in bands:
        h = w = 0
        for r in dir_records:
            dtt = r.get("days_to_t") or r.get("d_event") or r.get("days_to_event") or r.get("pre_catalyst_days")
            if dtt is None:
                continue
            try:
                dtt = float(dtt)
            except (TypeError, ValueError):
                continue
            if not (lo <= dtt < hi):
                continue
            d = str(r.get("dir_v4") or r.get("direction") or "")
            actual = None
            for k in ("d3_pct", "d5_pct", "d3_actual", "d5_actual"):
                v = r.get(k)
                if v is not None:
                    try:
                        actual = float(v)
                        break
                    except (TypeError, ValueError):
                        pass
            if actual is None:
                continue
            ok = (d.startswith("↑") and actual > 0) or (d.startswith("↓") and actual < 0)
            if ok: h += 1
            else:  w += 1
        tot = h + w
        pct = (100*h/tot) if tot else 0
        print(f"  T={lo:+4d}…{hi:+4d}gg : n={tot:5d}  hit={pct:5.1f}%")
    print()

    # Hit% per fascia affidabilita (su tutti i direzionali con actual)
    print("Hit% direzionale per fascia affidabilita:")
    for lo, hi in [(1, 29), (30, 49), (50, 64), (65, 79), (80, 100)]:
        h = w = 0
        for r in dir_records:
            ai = int(r.get("affidabilita", 0) or 0)
            if not (lo <= ai <= hi):
                continue
            d = str(r.get("dir_v4") or r.get("direction") or "")
            actual = None
            for k in ("d3_pct", "d5_pct", "d3_actual", "d5_actual"):
                v = r.get(k)
                if v is not None:
                    try:
                        actual = float(v)
                        break
                    except (TypeError, ValueError):
                        pass
            if actual is None:
                continue
            ok = (d.startswith("↑") and actual > 0) or (d.startswith("↓") and actual < 0)
            if ok: h += 1
            else:  w += 1
        tot = h + w
        pct = (100*h/tot) if tot else 0
        print(f"  affid={lo:3d}…{hi:3d}: n={tot:5d}  hit={pct:5.1f}%")
    print()

    # Check: che orizzonte temporale rappresenta `actual`?
    # Esempio: r['d5_pct'] e' la variazione % a T+5? o a CD+5?
    print("Campione di 5 record direzionali con actual e days_to_t:")
    cnt = 0
    for r in dir_records:
        if cnt >= 5: break
        d  = str(r.get("dir_v4") or r.get("direction") or "")
        actual_keys = {k: r.get(k) for k in ("d3_pct","d5_pct","d3_actual","d5_actual") if r.get(k) is not None}
        print(f"  ticker={r.get('ticker','?'):8s} days_to_t={r.get('pre_catalyst_days','?')} "
              f"affid={r.get('affidabilita','?')}  dir={d!r:25s}  actuals={actual_keys}")
        cnt += 1
    print()

    # === ANALISI MIRATA: dir_v4_tN vs actual al MATCHING orizzonte ===
    # Lo script attuale (_build_directional_calibration) usa dir_v4 generico
    # e attual a "any horizon" -> mismatch. Qui valuto dir_v4_tN vs dN_pct.
    print("=== Hit% direzionale per orizzonte specifico (matched horizon) ===")
    for h_label, dir_key, act_key in (
        ("T+1", "dir_v4_t1", "d1_pct"),
        ("T+3", "dir_v4_t3", "d3_pct"),
        ("T+5", "dir_v4_t5", "d5_pct"),
    ):
        records = [r for r in aff_gt0 if r.get(dir_key) and r.get(act_key) is not None]
        dir_rec = [r for r in records if str(r.get(dir_key,"")).startswith(("\u2191","\u2193"))]
        h = w = 0
        for r in dir_rec:
            try:
                a = float(r.get(act_key))
            except (TypeError, ValueError):
                continue
            d = str(r.get(dir_key,""))
            ok = (d.startswith("\u2191") and a > 0) or (d.startswith("\u2193") and a < 0)
            if ok: h += 1
            else:  w += 1
        tot = h + w
        pct = 100*h/tot if tot else 0
        print(f"  {h_label}: n_dir={len(dir_rec):5d}  validi={tot:5d}  hit={pct:5.1f}%")
    print()

    # === Hit% per fascia pre_catalyst_days su dir_v4_t5 vs d5_pct (matched) ===
    print("Hit% (dir_v4_t5 vs d5_pct) per fascia pre_catalyst_days:")
    bands = [(0, 7), (7, 15), (15, 30), (30, 60), (60, 99999)]
    for lo, hi in bands:
        h = w = 0
        for r in aff_gt0:
            d = str(r.get("dir_v4_t5") or "")
            if not d.startswith(("\u2191","\u2193")):
                continue
            try:
                a = float(r.get("d5_pct"))
            except (TypeError, ValueError):
                continue
            pcd = r.get("pre_catalyst_days")
            try:
                pcd = float(pcd)
            except (TypeError, ValueError):
                continue
            if not (lo <= pcd < hi):
                continue
            ok = (d.startswith("\u2191") and a > 0) or (d.startswith("\u2193") and a < 0)
            if ok: h += 1
            else:  w += 1
        tot = h + w
        pct = 100*h/tot if tot else 0
        print(f"  pre_cd={lo:3d}..{hi:5d}gg: n={tot:5d}  hit={pct:5.1f}%")
    print()

    # === Hit% per fascia |d5_pct| (esclude "rumore") ===
    print("Hit% (dir_v4_t5 vs d5_pct) per fascia |d5_pct| (filtro rumore):")
    for lo, hi in [(0, 1), (1, 2), (2, 3), (3, 5), (5, 10), (10, 999)]:
        h = w = 0
        for r in aff_gt0:
            d = str(r.get("dir_v4_t5") or "")
            if not d.startswith(("\u2191","\u2193")):
                continue
            try:
                a = float(r.get("d5_pct"))
            except (TypeError, ValueError):
                continue
            mag = abs(a)
            if not (lo <= mag < hi):
                continue
            ok = (d.startswith("\u2191") and a > 0) or (d.startswith("\u2193") and a < 0)
            if ok: h += 1
            else:  w += 1
        tot = h + w
        pct = 100*h/tot if tot else 0
        print(f"  |d5|={lo:2d}..{hi:3d}%: n={tot:5d}  hit={pct:5.1f}%")

if __name__ == "__main__":
    main()
