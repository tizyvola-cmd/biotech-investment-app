"""Quick validation script for rescue_cause_attribution."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from prediction.rescue_cause_attribution import (
    compute_volume_anomaly,
    compute_external_alignment,
    compute_cause_attribution,
)

out = []

# Test 1: Volume anomaly - insufficient data
r = compute_volume_anomaly([100, 200, 300])
assert r["status"] == "insufficient_history", f"FAIL T1: {r}"
out.append("T1 PASS: insufficient history")

# Test 2: Normal volume = low score
vols = [1_000_000.0] * 20 + [1_000_000.0]
r = compute_volume_anomaly(vols)
assert r["status"] == "ok", f"FAIL T2: {r}"
assert r["score"] == 0.0, f"FAIL T2 score: {r['score']}"
out.append(f"T2 PASS: normal vol score={r['score']}")

# Test 3: Volume spike = high score
vols = [1_000_000.0] * 20 + [5_000_000.0]
r = compute_volume_anomaly(vols)
assert r["status"] == "ok", f"FAIL T3: {r}"
assert r["score"] >= 60, f"FAIL T3 score too low: {r['score']}"
out.append(f"T3 PASS: spike score={r['score']} zscore={r['volume_zscore']}")

# Test 4: External alignment - perfectly aligned
closes = [100.0, 101.0, 102.0, 103.0, 104.0, 105.0]
xbi = [50.0, 50.5, 51.0, 51.5, 52.0, 52.5]
r = compute_external_alignment(closes, xbi)
assert r["status"] == "ok", f"FAIL T4: {r}"
assert r["score"] == 100.0, f"FAIL T4 score: {r['score']}"
out.append(f"T4 PASS: aligned score={r['score']}")

# Test 5: External alignment - diverging
closes = [100.0, 98.0, 96.0, 92.0, 85.0, 80.0]
xbi = [50.0, 50.0, 50.0, 50.0, 50.0, 50.0]
r = compute_external_alignment(closes, xbi)
assert r["status"] == "ok", f"FAIL T5: {r}"
assert r["score"] <= 30, f"FAIL T5 score too high: {r['score']}"
out.append(f"T5 PASS: diverging score={r['score']} gap={r['return_gap_pct']}")

# Test 6: Combined - internal flag
vols = [1_000_000.0] * 20 + [5_000_000.0]
closes = [100.0] * 16 + [100.0, 98.0, 96.0, 92.0, 85.0, 80.0]
xbi = [50.0] * 22
r = compute_cause_attribution(closes, vols, xbi)
assert r["internal_cause_flag"] is True, f"FAIL T6 internal: {r}"
assert r["external_cause_flag"] is False, f"FAIL T6 external: {r}"
out.append(f"T6 PASS: internal_flag=True vol={r['volume_anomaly']['score']} ext={r['external_alignment']['score']}")

# Test 7: Combined - external flag
vols = [1_000_000.0] * 21
closes = [100.0] * 16 + [100.0, 98.0, 96.0, 94.0, 92.0, 90.0]
xbi = [50.0] * 16 + [50.0, 49.0, 48.0, 47.0, 46.0, 45.0]
r = compute_cause_attribution(closes, vols, xbi)
assert r["external_cause_flag"] is True, f"FAIL T7 external: {r}"
assert r["internal_cause_flag"] is False, f"FAIL T7 internal: {r}"
out.append(f"T7 PASS: external_flag=True vol={r['volume_anomaly']['score']} ext={r['external_alignment']['score']}")

result = "\n".join(out)
with open("_test_cause_attr_result.txt", "w") as f:
    f.write(result + "\n")
print(result)
