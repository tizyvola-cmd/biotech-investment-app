"""Valutazione miglioramento accuratezza modello nel tempo (snapshot AccMonitor)."""
from __future__ import annotations

import json
import statistics as st
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def fnum(x):
    if x is None:
        return None
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def load_entries(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    d = json.loads(path.read_text(encoding="utf-8"))
    return [e for e in (d.get("entries") or []) if isinstance(e, dict)]


def main() -> None:
    pre = load_entries(DATA / "model_accuracy_monitor_history_pre_reset_20260513_164433.json")
    cur = load_entries(DATA / "model_accuracy_monitor_history.json")
    all_e = pre + cur

    valid = [e for e in all_e if fnum(e.get("acc_v4_pct")) is not None]
    valid.sort(key=lambda e: str(e.get("run_iso") or ""))

    print("=== VALUTAZIONE ACCURATEZZA NEL TEMPO ===\n")
    print(f"Snapshot totali: {len(all_e)} | con Acc% v4 valutabile: {len(valid)}")
    print(f"Fonti: pre-reset ({len(pre)}) + corrente ({len(cur)})\n")

    if len(valid) < 2:
        print("Dati insufficienti nello storico monitor (serve almeno 2 snapshot con Acc%).")
        print("Stato attuale: dopo reset del 13/05/2026 c'è 1 sola riga senza N valutabile.")
        print("Azione: eseguire orchestrator con ACCURACY_MONITOR_EVERY_RUN=1 o dopo ricalibrazione.")
        return

    first, last = valid[0], valid[-1]
    print(
        f"Intervallo: {first.get('run_iso')} -> {last.get('run_iso')}\n"
        f"  Primo: Acc {first.get('acc_v4_pct')}%  (N={first.get('n_evaluable_ok_v4')})\n"
        f"  Ultimo: Acc {last.get('acc_v4_pct')}%  (N={last.get('n_evaluable_ok_v4')})\n"
        f"  Delta totale: {float(last['acc_v4_pct']) - float(first['acc_v4_pct']):+.2f} punti percentuali\n"
    )

    accs = [float(e["acc_v4_pct"]) for e in valid]
    print(
        "Distribuzione Acc% v4 (coorte strict per snapshot):\n"
        f"  media {st.mean(accs):.2f}% | mediana {st.median(accs):.2f}% | "
        f"min {min(accs):.2f}% | max {max(accs):.2f}% | "
        f"dev.std {st.stdev(accs) if len(accs) > 1 else 0:.2f} pp\n"
    )

    mae_rows = [e for e in valid if fnum(e.get("m2_mae_7_pp")) is not None]
    if mae_rows:
        maes = [float(e["m2_mae_7_pp"]) for e in mae_rows]
        print(
            "Errore numerico pool (MAE T+5, pp) — più basso è meglio:\n"
            f"  media {st.mean(maes):.2f} | primo {maes[0]:.2f} | ultimo {maes[-1]:.2f} | "
            f"delta MAE {maes[-1] - maes[0]:+.2f} pp\n"
            f"  Aff.misurata proxy (100-MAE): {100 - maes[-1]:.1f}% (ultimo)\n"
        )

    k = max(1, len(accs) // 3)
    p1, p3 = accs[:k], accs[-k:]
    print(
        "Confronto periodi (terzili cronologici):\n"
        f"  primo terzo ({k} snap): {st.mean(p1):.2f}%\n"
        f"  ultimo terzo ({k} snap): {st.mean(p3):.2f}%\n"
        f"  miglioramento medio: {st.mean(p3) - st.mean(p1):+.2f} pp\n"
    )

    n = len(accs)
    if n >= 3:
        xs = list(range(n))
        mx, my = st.mean(xs), st.mean(accs)
        den = sum((x - mx) ** 2 for x in xs) or 1.0
        beta = sum((xs[i] - mx) * (accs[i] - my) for i in range(n)) / den
        print(f"Trend (regressione Acc% vs #snapshot): {beta:+.3f} punti percentuali per run\n")

    by_week: dict[str, list[float]] = defaultdict(list)
    for e in valid:
        iso = str(e.get("run_iso") or "")[:10]
        try:
            wk = datetime.fromisoformat(iso).strftime("%Y-W%W")
        except ValueError:
            wk = iso[:7]
        by_week[wk].append(float(e["acc_v4_pct"]))

    print("Acc% media per settimana (ultime 10):")
    for wk in sorted(by_week.keys())[-10:]:
        v = by_week[wk]
        print(
            f"  {wk}: snap={len(v):2d}  media={st.mean(v):5.2f}%  "
            f"[{min(v):.1f} - {max(v):.1f}]"
        )

    recal_n = sum(1 for e in valid if e.get("recalibrated") in (True, 1, "true"))
    print(f"\nSnapshot con ricalibrazione stato: {recal_n} / {len(valid)}")

    deltas = [fnum(e.get("delta_pp_vs_prev")) for e in valid if fnum(e.get("delta_pp_vs_prev")) is not None]
    if deltas:
        pos = sum(1 for d in deltas if d > 0)
        print(
            f"Dpp vs run precedente: media {st.mean(deltas):+.2f} | "
            f"migliorati {pos}/{len(deltas)} ({100*pos/len(deltas):.0f}%)\n"
        )

    # cal_factor
    cf_series = [
        (str(e.get("run_iso")), float(e["cal_factor_v4"]))
        for e in valid
        if fnum(e.get("cal_factor_v4")) is not None
    ]
    if cf_series:
        print(
            f"cal_factor v4: {cf_series[0][1]:.3f} -> {cf_series[-1][1]:.3f} "
            f"(interpretazione: <1 modello sovrastima vs target registry)\n"
        )

    print("--- SINTESI ---")
    delta_total = float(last["acc_v4_pct"]) - float(first["acc_v4_pct"])
    delta_period = st.mean(p3) - st.mean(p1)
    if delta_total >= 2 and delta_period >= 1:
        verdict = "miglioramento moderato–chiaro nel periodo osservato"
    elif delta_total > 0.5:
        verdict = "miglioramento lieve, non ancora stabile"
    elif delta_total > -0.5:
        verdict = "sostanzialmente stabile (nessun salto netto)"
    else:
        verdict = "peggioramento nel periodo osservato"
    print(f"Giudizio: {verdict}.")
    print(
        "Nota: ogni riga e la coorte intera allo snapshot, non un singolo titolo; "
        "dopo il reset del 13/05/2026 lo storico corrente va ripopolato con nuovi run."
    )

    _print_calibration_and_monitor_health()


def _print_calibration_and_monitor_health() -> None:
    print("\n=== CALIBRAZIONE E SALUTE MONITOR ===\n")
    pc_path = DATA / "pred_calibration.json"
    if pc_path.is_file():
        pc = json.loads(pc_path.read_text(encoding="utf-8"))
        recs = pc if isinstance(pc, list) else pc.get("records", pc.get("entries", []))
        if not isinstance(recs, list):
            recs = []
        stati = Counter(str(r.get("status", "?")) for r in recs if isinstance(r, dict))
        complete = [r for r in recs if isinstance(r, dict) and r.get("status") == "complete"]
        print(f"pred_calibration: {len(recs)} record | status {dict(stati)}")
        print(f"  complete (esiti T+N misurabili): {len(complete)}")
        if not complete:
            print(
                "  -> post-hoc e mag-bucket NON calcolabili finche restano tutti pending."
            )

    cs_path = DATA / "model_calibration_state.json"
    if cs_path.is_file():
        cs = json.loads(cs_path.read_text(encoding="utf-8")).get("current") or {}
        cf = cs.get("cal_factor") or {}
        ph = cs.get("posthoc_regression") or {}
        mb = cs.get("magnitude_bucket_calibration") or {}
        print(
            f"model_calibration_state: n_retro={cs.get('n_retro_total')} "
            f"cal_factor v4={cf.get('v4_options')}"
        )
        print(
            f"  posthoc orizzonti={ph.get('n_horizons_fitted')} | "
            f"mag-bucket orizzonti={mb.get('n_horizons_with_buckets')}"
        )

    for label, path in (
        ("pre-reset", DATA / "model_accuracy_monitor_history_pre_reset_20260513_164433.json"),
        ("corrente", DATA / "model_accuracy_monitor_history.json"),
    ):
        if not path.is_file():
            continue
        ents = json.loads(path.read_text(encoding="utf-8")).get("entries") or []
        n_ok = sum(
            1 for e in ents if isinstance(e, dict) and e.get("acc_v4_pct") is not None
        )
        n0 = sum(
            1
            for e in ents
            if isinstance(e, dict) and (e.get("n_evaluable_ok_v4") or 0) == 0
        )
        print(f"monitor {label}: {len(ents)} snap | Acc% ok={n_ok} | N=0={n0}")

    pre_path = DATA / "model_accuracy_monitor_history_pre_reset_20260513_164433.json"
    if pre_path.is_file():
        pre = json.loads(pre_path.read_text(encoding="utf-8"))
        broken = [
            e
            for e in pre.get("entries", [])
            if isinstance(e, dict) and str(e.get("run_iso") or "") >= "2026-05-10"
        ]
        if broken:
            null_acc = sum(1 for e in broken if e.get("acc_v4_pct") is None)
            print(
                f"\nDal 10/05/2026 (pre-reset): {len(broken)} run, "
                f"{null_acc} senza Acc% (coorte N=0 / monitor non valorizzato)."
            )


if __name__ == "__main__":
    main()
