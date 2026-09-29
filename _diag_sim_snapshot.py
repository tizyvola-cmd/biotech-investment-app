"""Estrae per ogni ticker portfolio il NCT dal simulation_sheet_snapshot."""
import json

PORTFOLIO = ['CRDF', 'DSGN', 'IRWD', 'PBYI', 'TELA', 'WVE']

sim = json.load(open('/opt/biotech/data/simulation_sheet_snapshot.json'))
rows = sim.get('rows') or []
print(f'Simulation rows: {len(rows)}')
print(f'Columns sample: {list(rows[0].keys()) if rows else "N/A"}')
print()

for target in PORTFOLIO:
    matches = [r for r in rows if str(r.get('ticker') or r.get('Ticker') or '').strip().upper() == target]
    if not matches:
        print(f'{target}: NESSUNA riga nel simulation snapshot')
        continue
    for r in matches:
        print(f'{target}:')
        for k in ('ticker', 'Ticker', 'nct_id', 'nctId', 'nct', 'primary_completion_date',
                 'completion_date', 'cd', 'CD', 'completion', 'company', 'query_company',
                 'lead_sponsor', 'sponsor_match', 'brief_title', 'phase'):
            v = r.get(k)
            if v not in (None, '', {}):
                s = str(v)
                if len(s) > 100:
                    s = s[:100] + '...'
                print(f'  {k}: {s}')
        print()
