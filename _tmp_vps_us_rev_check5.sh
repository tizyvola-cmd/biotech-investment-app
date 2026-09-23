#!/bin/bash
echo ===ASSET CACHE===
curl -sI "http://127.0.0.1:8765/assets/InvestmentSimulationView-DJUWKg8Q.js" | head -15
echo ===SW===
ls /opt/biotech/desktop-ui/dist/sw.js /opt/biotech/desktop-ui/dist/service-worker.js 2>/dev/null || echo no_sw
ls /opt/biotech/desktop-ui/dist/ | head -20