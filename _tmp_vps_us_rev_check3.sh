#!/bin/bash
TOKEN=$(tr -d "\r\n" < /opt/biotech/.supernova_api_token 2>/dev/null || true)
echo "token_len=${#TOKEN}"
curl -s -X POST http://127.0.0.1:8765/api/desk/us-product-revenue/lookup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"ticker":"AZN"}' > /tmp/azn_rev.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/azn_rev.json"))
print("top_keys", sorted(d.keys())[:20])
print("ok", d.get("ok"), "cached", d.get("cached"), "error", d.get("error"))
ps=d.get("products") or []
print("n", len(ps))
if ps:
  print("fields", sorted(ps[0].keys()))
  for p in ps[:3]:
    print("---", p.get("name"))
    print("  ind", p.get("indication"))
    print("  moa", p.get("moa_target"))
    print("  mod", p.get("modality"))
    print("  prev", p.get("usa_prevalence"))
PY
echo ===BUNDLE COLS===
grep -o "MoA / target\|Prevalenza USA\|Patent cliff\|line_of_therapy\|moa_target" /opt/biotech/desktop-ui/dist/assets/InvestmentSimulationView-DJUWKg8Q.js | sort | uniq -c