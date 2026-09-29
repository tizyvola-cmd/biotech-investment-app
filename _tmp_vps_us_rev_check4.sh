#!/bin/bash
echo ===INDEX HEADERS===
curl -sI http://127.0.0.1:8765/ | head -20
echo ===INDEX ASSET===
curl -s http://127.0.0.1:8765/ | grep -oE "assets/index-[^\"]+|assets/InvestmentSimulationView-[^\"]+"
echo ===EXTERNAL===
curl -sI http://91.99.15.48:8765/ | head -15
curl -s http://91.99.15.48:8765/ | grep -oE "assets/index-[^\"]+|assets/InvestmentSimulationView-[^\"]+"
echo ===JS HAS COLS===
curl -s "http://127.0.0.1:8765/assets/InvestmentSimulationView-DJUWKg8Q.js" | python3 -c "import sys;t=sys.stdin.read();print({k:t.count(k) for k in ['MoA / target','Prevalenza USA','moa_target','Indication ·']})"