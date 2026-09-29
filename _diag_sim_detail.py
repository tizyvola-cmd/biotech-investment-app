"""Estrae dettagli COMPLETI simulation_sheet_snapshot per portfolio tickers."""
import json
import sys

PORTFOLIO = ['CRDF', 'DSGN', 'IRWD', 'PBYI', 'TELA', 'WVE']

sim = json.load(open('/opt/biotech/data/simulation_sheet_snapshot.json'))
rows = sim.get('rows') or []

# Get all unique keys across rows
all_keys = set()
for r in rows:
    all_keys.update(r.keys())

# Print all tickers found in sim
tickers_present = sorted({str(r.get('Ticker') or r.get('ticker') or '').strip().upper() for r in rows if r})
print(f'Total sim rows: {len(rows)}')
print(f'Tickers in simulation snapshot: {tickers_present}')
print()

for target in PORTFOLIO:
    matches = [r for r in rows if str(r.get('Ticker') or r.get('ticker') or '').strip().upper() == target]
    if not matches:
        print(f'--- {target}: NOT IN SIM SNAPSHOT ---')
        continue
    r = matches[0]
    print(f'--- {target} ---')
    for k in sorted(r.keys()):
        v = r.get(k)
        if v in (None, '', {}, []):
            continue
        s = str(v)
        if len(s) > 120:
            s = s[:120] + '...'
        print(f'  {k!r}: {s}')
    print()
