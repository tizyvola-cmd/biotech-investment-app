#!/bin/bash
set -euo pipefail
BASE=http://127.0.0.1:8765
echo "===PROJECT-DATA==="
for p in \
  ai_secrets.json \
  tester_feedback_store.json \
  invest_sim_inputs.json \
  invest_sim_history.json \
  desktop_ui_prefs.json \
  mobile_dashboard_snapshot.json \
  desktop_data_manifest.json \
  clinical_pre_cd_enrichment_snapshot.json \
  market_context_snapshot.json
do
  code=$(curl -s -o "/tmp/pd_out.json" -w "%{http_code}" "$BASE/project-data/$p" || echo ERR)
  bytes=$(wc -c < /tmp/pd_out.json | tr -d ' ')
  echo "$p -> $code bytes=$bytes"
done
echo "===SENSITIVE_API_NO_TOKEN==="
for path in \
  /api/tester-feedback/summary \
  /api/tester-feedback/events \
  /api/tester-feedback/export \
  /api/ai/secrets \
  /api/investment/sim-inputs \
  /api/market/daily-news/brief \
  /api/market/daily-news/analyze \
  /api/hype-volume-funnel/scan
do
  method=GET
  case "$path" in
    */brief|*/analyze|*/scan) method=POST ;;
  esac
  code=$(curl -s -o /tmp/api_out.json -w "%{http_code}" -X "$method" \
    -H "Content-Type: application/json" -d '{}' "$BASE$path" || echo ERR)
  echo "$method $path -> $code"
done
echo "===HEALTH==="
curl -s -o /dev/null -w "health %{http_code} time=%{time_total}\n" "$BASE/api/health"
echo "===MOBILE_SNAP_HEADERS==="
curl -sI "$BASE/api/mobile/dashboard-snapshot" | tr -d '\r' | head -25
echo "===FILES==="
ls -la /opt/biotech/data/ai_secrets.json /opt/biotech/data/tester_feedback_store.json 2>&1 | head -5
echo "===WEB_BUILD_TOKEN_LEAK==="
if [ -d /opt/biotech/desktop-ui/dist-web ]; then
  rg -l "VITE_SUPERNOVA|SUPERNOVA_API_TOKEN|X-SuperNova-Token" /opt/biotech/desktop-ui/dist-web -g '*.js' 2>/dev/null | head -5 || true
  rg -n "sk-|AIza|gemini|anthropic" /opt/biotech/desktop-ui/dist-web -g '*.js' 2>/dev/null | head -3 || true
fi
if [ -d /opt/biotech/desktop-ui/dist-web-vps ]; then
  # Look for long token-like strings embedded; just check env var name leakage
  rg -n "VITE_SUPERNOVA_API_TOKEN" /opt/biotech/desktop-ui/dist-web-vps -g '*.js' 2>/dev/null | head -5 || echo "no VITE_SUPERNOVA_API_TOKEN string in dist-web-vps"
fi
