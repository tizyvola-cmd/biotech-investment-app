#!/bin/bash
echo ===CHUNKS===
grep -l "moa_target\|MoA / target\|Prevalenza USA" /opt/biotech/desktop-ui/dist/assets/*.js | head -10
echo ===API AZN===
TOKEN=""
if [ -f /opt/biotech/.supernova_api_token ]; then TOKEN=$(cat /opt/biotech/.supernova_api_token | tr -d "\r\n"); fi
# try without auth first
curl -s -X POST http://127.0.0.1:8765/api/desk/us-product-revenue \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"ticker":"AZN"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok',d.get('ok'),'cached',d.get('cached'),'n',len(d.get('products') or []));
ps=d.get('products') or [];
print('fields0', sorted((ps[0] or {}).keys()) if ps else None);
print('row0', {k:(ps[0] or {}).get(k) for k in ('name','indication','moa_target','modality','usa_prevalence')} if ps else None)"