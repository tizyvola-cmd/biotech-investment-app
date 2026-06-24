"""Diagnostic: is the "other" cluster (and its big movers) a usable learning source?

Run on the machine that holds data/ :
    .venv\\Scripts\\python.exe diag_other_cluster.py

It does NOT write anything. It answers three questions:
  1. How big is "other" vs the 9 cohorts, and WHY do tickers land there
     (missing phase metadata vs therapeutic area not covered by the keyword map)?
  2. Does "other" carry any learnable magnitude signal as a single bucket
     (bias / direction accuracy / variance-explained / solver cal_factor)?
  3. Cross-area hypothesis: are BIG MOVERS systematically mis-scaled
     (magnitude compression) regardless of cluster -> a learnable tier signal?
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from prediction.cluster_cal_factor import (
    CLUSTER_MIN_DIRECTION_ACC,
    _solve_cluster_cal_factor,
    classify_ticker,
    collect_resolved_outcomes_from_sources,
)

# Extended area keywords used ONLY to explain what is hiding inside "other".
# These are NOT the production clusters; they just label the grab-bag so we can
# see which uncovered cohorts are big enough to deserve their own cluster.
EXTENDED_AREAS: dict[str, list[str]] = {
    "cns_neuro": ["alzheimer", "parkinson", "epilep", "neuro", "cns", "depress",
                  "schizo", "migraine", " als", "multiple sclerosis", "seizure",
                  "psych", "huntington", "pain"],
    "cardio": ["cardio", "heart", "hypertens", "cholesterol", "atrial", "thromb",
               "stroke", "lipid", "coronary"],
    "respiratory": ["asthma", "copd", "pulmonary", "respirat", "cystic fibrosis",
                    "ipf", "fibrosis"],
    "ophthalmology": ["ophthal", "retina", "macular", "glaucoma", " eye", "vision"],
    "hematology_nononc": ["anemia", "hemophilia", "sickle", "thrombocyt",
                          "blood", "bleeding", "von willebrand"],
    "infectious_vaccine": ["vaccin", "infect", "viral", " hiv", "hepatitis",
                           "covid", "influenza", "bacter", "antibiot", "fungal"],
    "dermatology": ["dermat", "skin", "eczema", "atopic", "psorias", "acne"],
    "gi_hep": ["crohn", "colitis", " ibd", "liver", "hepat", "gastro", "bowel"],
    "renal": ["renal", "kidney", " ckd", "nephro"],
    "gene_cell": ["gene therapy", "cell therapy", "car-t", " aav", "gene-edit",
                  "crispr"],
    "onc_synonym_missed": ["nsclc", "sclc", "leukemia", "myeloma", "glioblast",
                           "solid tumor", "metasta", "sarcoma", "blastoma"],
}


def _stats(pairs: list[tuple[float, float]]) -> dict[str, Any]:
    n = len(pairs)
    if n == 0:
        return {"n": 0}
    bias = sum(p - a for p, a in pairs) / n
    mae = sum(abs(p - a) for p, a in pairs) / n
    dir_acc = sum(1 for p, a in pairs if (p > 0) == (a > 0)) / n
    sp2 = sum(p * p for p, _ in pairs)
    sa2 = sum(a * a for _, a in pairs)
    spa = sum(p * a for p, a in pairs)
    rho2 = (spa * spa) / (sp2 * sa2) if sp2 > 1e-9 and sa2 > 1e-9 else 0.0
    cal, status = _solve_cluster_cal_factor(pairs, mae, dir_acc)
    mean_abs_pred = sum(abs(p) for p, _ in pairs) / n
    mean_abs_act = sum(abs(a) for _, a in pairs) / n
    ratio = (mean_abs_act / mean_abs_pred) if mean_abs_pred > 1e-9 else float("nan")
    return {
        "n": n, "bias_pp": round(bias, 2), "mae_pp": round(mae, 2),
        "dir_acc": round(dir_acc, 3), "rho2": round(rho2, 4),
        "cal_factor": round(cal, 3), "status": status,
        "mean_abs_pred": round(mean_abs_pred, 2),
        "mean_abs_act": round(mean_abs_act, 2),
        "mag_ratio_act_over_pred": round(ratio, 3),
    }


def _infer_area(phase: str, condition: str) -> str:
    c = (condition or "").lower()
    if not c.strip():
        return "MISSING_condition" if not (phase or "").strip() else "MISSING_condition_has_phase"
    for area, kws in EXTENDED_AREAS.items():
        if any(k in c for k in kws):
            return area
    return "uncovered_misc"


def main() -> None:
    outcomes = collect_resolved_outcomes_from_sources()
    by_cluster: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for o in outcomes:
        td = o.get("ticker_data") or {"phase": o.get("phase", ""), "condition": o.get("condition", "")}
        by_cluster[classify_ticker(td)].append(o)

    def pairs(rows: list[dict[str, Any]]) -> list[tuple[float, float]]:
        return [(float(r["pred"]), float(r["actual"])) for r in rows
                if r.get("pred") is not None and r.get("actual") is not None]

    print("=" * 78)
    print(f"TOTAL resolved outcomes: {len(outcomes)}")
    print("=" * 78)
    print("\n[1] CLUSTER SIZES (n outcomes per cohort)")
    for name in sorted(by_cluster, key=lambda k: -len(by_cluster[k])):
        share = 100.0 * len(by_cluster[name]) / max(1, len(outcomes))
        print(f"  {name:24s} n={len(by_cluster[name]):4d}  ({share:4.1f}%)")

    other = by_cluster.get("other", [])
    print("\n" + "=" * 78)
    print(f"[2] 'other' AS A SINGLE BUCKET  (n={len(other)})")
    print("=" * 78)
    st = _stats(pairs(other))
    for k, v in st.items():
        print(f"  {k:24s} {v}")
    print(f"  (note: dir floor for activation = {CLUSTER_MIN_DIRECTION_ACC}; "
          f"low rho2 => solver holds near 1.0 = 'learns nothing')")

    print("\n[3] WHY tickers land in 'other' (inferred area breakdown)")
    area_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for o in other:
        td = o.get("ticker_data") or {}
        area_rows[_infer_area(td.get("phase", ""), td.get("condition", ""))].append(o)
    for area in sorted(area_rows, key=lambda k: -len(area_rows[k])):
        s = _stats(pairs(area_rows[area]))
        print(f"  {area:26s} n={s['n']:4d}  bias={s.get('bias_pp')}  "
              f"dir={s.get('dir_acc')}  rho2={s.get('rho2')}  "
              f"mag_ratio={s.get('mag_ratio_act_over_pred')}")

    print("\n[4] BIG MOVERS inside 'other' (top 25 by |actual|)")
    big = sorted(other, key=lambda r: -abs(float(r.get("actual") or 0.0)))[:25]
    print(f"  {'ticker':8s} {'node':5s} {'pred':>8s} {'actual':>8s} {'err':>8s}  phase / condition")
    for r in big:
        pred = float(r.get("pred") or 0.0)
        act = float(r.get("actual") or 0.0)
        td = r.get("ticker_data") or {}
        ph = str(td.get("phase", ""))[:18]
        cond = str(td.get("condition", ""))[:30]
        print(f"  {str(r.get('ticker'))[:8]:8s} {str(r.get('node')):5s} "
              f"{pred:8.2f} {act:8.2f} {pred-act:8.2f}  {ph} / {cond}")

    print("\n" + "=" * 78)
    print("[5] MAGNITUDE-TIER hypothesis: are BIG MOVERS mis-scaled cross-area?")
    print("=" * 78)
    tiers = [(0, 5), (5, 15), (15, 30), (30, 60), (60, 1e9)]
    allp = pairs(outcomes)
    print("  WHOLE POOL by |actual| tier:")
    for lo, hi in tiers:
        seg = [(p, a) for p, a in allp if lo <= abs(a) < hi]
        if not seg:
            continue
        s = _stats(seg)
        print(f"   |act| [{lo:>3}-{hi if hi < 1e9 else 'inf':>3}) "
              f"n={s['n']:4d}  signed_err(pred-act)={s['bias_pp']:>7}  "
              f"dir={s['dir_acc']}  mag_ratio={s['mag_ratio_act_over_pred']}  rho2={s['rho2']}")
    print("  'other' ONLY by |actual| tier:")
    op = pairs(other)
    for lo, hi in tiers:
        seg = [(p, a) for p, a in op if lo <= abs(a) < hi]
        if not seg:
            continue
        s = _stats(seg)
        print(f"   |act| [{lo:>3}-{hi if hi < 1e9 else 'inf':>3}) "
              f"n={s['n']:4d}  signed_err(pred-act)={s['bias_pp']:>7}  "
              f"dir={s['dir_acc']}  mag_ratio={s['mag_ratio_act_over_pred']}  rho2={s['rho2']}")
    print("\n  Reading: mag_ratio >> 1 in high tiers => model COMPRESSES big moves")
    print("  (under-predicts magnitude) -> a learnable expansion signal if dir is sane.")

    print("\n" + "=" * 78)
    print("[6] ACTIONABILITY: bucket by |PRED| (ex-ante, what we have at predict time)")
    print("=" * 78)
    print("  A tier multiplier is usable ONLY if E[|actual|] rises with |pred|")
    print("  (otherwise we can't tell big movers apart before the fact).")
    pred_tiers = [(0, 3), (3, 6), (6, 10), (10, 15), (15, 1e9)]
    for lo, hi in pred_tiers:
        seg = [(p, a) for p, a in allp if lo <= abs(p) < hi]
        if not seg:
            continue
        n = len(seg)
        mean_abs_pred = sum(abs(p) for p, _ in seg) / n
        mean_abs_act = sum(abs(a) for _, a in seg) / n
        dir_acc = sum(1 for p, a in seg if (p > 0) == (a > 0)) / n
        frac_big = sum(1 for _, a in seg if abs(a) >= 15) / n
        ratio = mean_abs_act / mean_abs_pred if mean_abs_pred > 1e-9 else float("nan")
        print(f"   |pred| [{lo:>3}-{hi if hi < 1e9 else 'inf':>3}) n={n:4d}  "
              f"mean|pred|={mean_abs_pred:5.2f}  E[|act|]={mean_abs_act:5.2f}  "
              f"exp_factor={ratio:4.2f}  dir={dir_acc:.3f}  P(|act|>=15)={frac_big:.3f}")
    print("  exp_factor = E[|actual|]/mean|pred| per bucket = the calibration each")
    print("  |pred| bucket would need; monotone-rising E[|act|] => learnable map.")

    print("\n" + "=" * 78)
    print("[7] METADATA SOURCE PROBE: is 'other' a fixable routing/key problem?")
    print("=" * 78)
    from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON
    from past_pred_io import load_past_pred_map

    recs = load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON) or {}
    elig = {tk: r for tk, r in recs.items() if r.get("model_accuracy_metrics_eligible")}
    print(f"  past_pred recs total={len(recs)}  eligible={len(elig)}")
    cond_keys = ["indication", "condition", "Indication", "Condition",
                 "disease", "Disease", "therapeutic_area", "Therapeutic Area"]
    phase_keys = ["phase", "trial_phase", "Phase", "Studio Phase", "Clinical Phase"]
    cond_present = {k: sum(1 for r in elig.values() if str(r.get(k) or "").strip()) for k in cond_keys}
    phase_present = {k: sum(1 for r in elig.values() if str(r.get(k) or "").strip()) for k in phase_keys}
    print("  non-empty CONDITION-like keys across eligible recs:")
    for k, c in cond_present.items():
        if c:
            print(f"     {k:22s} {c}")
    if not any(cond_present.values()):
        print("     (NONE — condition truly absent in source, backfill must come from elsewhere)")
    print("  non-empty PHASE-like keys across eligible recs:")
    for k, c in phase_present.items():
        if c:
            print(f"     {k:22s} {c}")
    sample = list(elig.items())[:3]
    print("  sample eligible record keys (first 3):")
    for tk, r in sample:
        ks = [k for k in r.keys() if not k.startswith("model_") and not k.endswith("_pct")]
        print(f"     {tk}: {ks[:25]}")


if __name__ == "__main__":
    main()
