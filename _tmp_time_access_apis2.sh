#!/bin/bash
TOKEN=$(cat /opt/biotech/.supernova_api_token 2>/dev/null)
for i in 1 2 3; do
  curl -s -o /dev/null -w "health$i:%{time_total}s\n" http://127.0.0.1:8765/api/health
done
curl -s -o /dev/null -w "summary:%{time_total}s\n" -H "X-SuperNova-Token: $TOKEN" http://127.0.0.1:8765/api/tester-feedback/summary
python3 - <<'PY'
import time, json
from pathlib import Path
import sys
sys.path.insert(0, "/opt/biotech")
t0=time.time()
import tester_feedback_io as tf
t1=time.time()
print(f"import:{t1-t0:.3f}s")
t2=time.time()
s=tf.build_summary()
t3=time.time()
print(f"build_summary:{t3-t2:.3f}s testers={len(s.get('testers') or [])} events={s.get('events_total')}")
try:
  import supernova_pg as pg
  t4=time.time()
  h=pg.healthcheck()
  t5=time.time()
  print(f"pg.healthcheck:{t5-t4:.3f}s -> {h}")
except Exception as e:
  print("pg err", e)
PY
