"""Estrae i dati NCT/sponsor per ogni slot portfolio attivo."""
import json
import sys

d = json.load(open('/opt/biotech/data/invest_sim_inputs.json'))
inp = d.get('inputs') or {}

for k, v in inp.items():
    if not isinstance(v, dict):
        continue
    try:
        cap = float(v.get('capital') or 0)
        buy = float(v.get('buyPrice') or 0)
    except (TypeError, ValueError):
        continue
    if cap <= 0 or buy <= 0:
        continue
    print(f'=== {k} ===')
    for kk, vv in v.items():
        if kk in ('capital', 'buyPrice'):
            print(f'  {kk}: {vv}')
        elif isinstance(vv, (str, int, float, bool)) and vv:
            s = str(vv)
            if len(s) > 200:
                s = s[:200] + '...'
            print(f'  {kk}: {s}')
    print()
