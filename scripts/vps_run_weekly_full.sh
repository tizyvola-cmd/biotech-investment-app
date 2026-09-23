#!/usr/bin/env bash
set -euo pipefail
cd /opt/biotech
mkdir -p data/logs
LOG=data/logs/saturday_weekly_full_manual_20260705.log
if pgrep -f "data_orchestrator.py" >/dev/null 2>&1; then
  echo "Already running data_orchestrator"
  pgrep -af data_orchestrator
  exit 0
fi
nohup .venv/bin/python -u scripts/saturday_weekly_full_refresh.py --force --force-yfinance --quiet >>"$LOG" 2>&1 &
echo "started pid=$!"
sleep 3
pgrep -af "saturday_weekly_full|data_orchestrator" || true
tail -5 "$LOG" || true
