import os, sys
# Write immediately to confirm script runs
result_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_rca_out.txt")
with open(result_path, "w") as f:
    f.write("SCRIPT STARTED\n")
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from prediction.rescue_cause_attribution import (
            compute_volume_anomaly,
            compute_external_alignment,
            compute_cause_attribution,
        )
        f.write("IMPORT OK\n")

        # Test volume anomaly
        vols = [1_000_000.0] * 20 + [5_000_000.0]
        r = compute_volume_anomaly(vols)
        f.write(f"vol_anomaly: {r}\n")

        # Test external alignment - diverging
        closes = [100.0, 98.0, 96.0, 92.0, 85.0, 80.0]
        xbi = [50.0, 50.0, 50.0, 50.0, 50.0, 50.0]
        r2 = compute_external_alignment(closes, xbi)
        f.write(f"ext_align: {r2}\n")

        # Combined
        full_closes = [100.0]*16 + closes
        full_xbi = [50.0]*22
        r3 = compute_cause_attribution(full_closes, vols, full_xbi)
        f.write(f"combined: internal={r3['internal_cause_flag']} external={r3['external_cause_flag']}\n")
        f.write(f"vol_score={r3['volume_anomaly']['score']} ext_score={r3['external_alignment']['score']}\n")
        f.write("ALL OK\n")
    except Exception as e:
        f.write(f"ERROR: {type(e).__name__}: {e}\n")
        import traceback
        f.write(traceback.format_exc())
