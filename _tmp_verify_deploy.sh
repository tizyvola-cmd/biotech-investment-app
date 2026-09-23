#!/bin/bash
set -e
echo "=== SOURCE CHECKS ==="
echo -n "1 simplywall60: "
grep -c "hard-cut the slug at 60" /opt/biotech/daily_news_desk.py
echo -n "2 Expectation title: "
grep -c 'title: { it: "Expectation", en: "Expectation" }' /opt/biotech/desktop-ui/src/components/EventVolLegendModal.tsx
echo -n "3 softBuyExtract absent: "
grep -c "This extract is not a Soft BUY/SELL input" /opt/biotech/desktop-ui/src/sheet/deskReferenceExplain.ts || true
echo -n "3b simSheet absent in sourceLabel: "
grep -c "Simulation sheet CD" /opt/biotech/desktop-ui/src/sheet/deskReferenceExplain.ts || true
echo -n "3c separateIndex footer absent: "
grep -c "Separate index: not a Soft BUY/SELL gate" /opt/biotech/desktop-ui/src/components/DeskReferenceModal.tsx || true
echo -n "4 fuchsia company authors: "
grep -c "text-fuchsia-400\">company authors" /opt/biotech/desktop-ui/src/components/ProductStudyDossierPanel.tsx
echo -n "5 lookbackHours36: "
grep -c "DIMENSION_SCORE_LOOKBACK_HOURS = 36" /opt/biotech/desktop-ui/src/sheet/newsDimensionScores.ts
echo -n "5 tip36h: "
grep -c "last 36 hours" /opt/biotech/desktop-ui/src/components/EventVolLegendModal.tsx
echo -n "6 EM primary tip: "
grep -c "size of the jump the market prices" /opt/biotech/desktop-ui/src/sheet/eventVolIndexDisplay.ts

JS=$(ls /opt/biotech/desktop-ui/dist/assets/index-*.js | head -1)
echo "=== DIST $JS ==="
python3 - <<PY
from pathlib import Path
p = Path("$JS")
t = p.read_text(encoding="utf-8", errors="ignore")
checks = {
  "36h tip": "last 36 hours",
  "old 90d tip": "session aggregate + Deep Dive last 90d",
  "soft buy extract": "This extract is not a Soft BUY/SELL input",
  "sim sheet CD": "Simulation sheet CD",
  "EM jump tip": "size of the jump the market prices",
  "company authors": "company authors",
  "Expectation title plain": "Daily Score: \u03a3 Clin",
}
for k,v in checks.items():
    n = t.count(v)
    print(f"{k}: {n}")
PY
curl -s -o /dev/null -w "health:%{http_code}\n" http://127.0.0.1:8765/api/health
