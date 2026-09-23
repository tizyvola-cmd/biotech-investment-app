"""Diagnostica dettagliata sponsor per CRDF, DSGN e resto portfolio sul VPS."""
import json
import sys
sys.path.insert(0, '/opt/biotech')

from clinical_pre_cd_enrichment import _load_clinical_rows
from prediction.eis_feed_quality import (
    is_study_sponsor_trusted,
    recompute_record_sponsor_match,
    _meaningful_sponsor_overlap,
    _sponsor_tokens,
)
from fetch_edgar import _compute_sponsor_match, _match_one_orch, _norm

rows = _load_clinical_rows()
PORTFOLIO = {'CRDF', 'DSGN', 'IRWD', 'PBYI', 'TELA', 'WVE'}

print(f'Total clinical rows: {len(rows)}')
print(f'Fields on first row: {sorted(rows[0].keys()) if rows else "N/A"}')
print()

for row in rows:
    tk = str(row.get('ticker', '')).strip().upper()
    if tk not in PORTFOLIO:
        continue
    print(f'=== {tk} ===')
    for k in ('ticker', 'query_company', 'company', 'lead_sponsor', 'sponsor_match',
              'nct_id', 'primary_completion_date', 'brief_title'):
        v = row.get(k)
        if v is not None:
            print(f'  {k}: {v}')
    meta = row.get('meta') if isinstance(row.get('meta'), dict) else {}
    if meta:
        print(f'  meta.lead_sponsor: {meta.get("lead_sponsor")}')
        print(f'  meta.responsible_party_org: {meta.get("responsible_party_org")}')
        print(f'  meta.collaborators: {meta.get("collaborators")}')
    # recompute sponsor match
    sm = recompute_record_sponsor_match(row)
    print(f'  → recompute sponsor_match: {sm}')
    company = str(row.get('company') or row.get('query_company') or row.get('ticker') or '')
    lead = str((meta.get('lead_sponsor') if meta else '') or row.get('lead_sponsor') or '')
    if company and lead:
        overlap = _meaningful_sponsor_overlap(company, lead)
        common = _sponsor_tokens(company) & _sponsor_tokens(lead)
        print(f'  → tokens(company): {_sponsor_tokens(company)}')
        print(f'  → tokens(lead):    {_sponsor_tokens(lead)}')
        print(f'  → common tokens:   {common}')
        print(f'  → meaningful overlap: {overlap}')
        n1 = _norm(company)
        n2 = _norm(lead)
        moc = _match_one_orch(n1, n2)
        print(f'  → _match_one_orch("{n1}", "{n2}") = {moc}')
    trusted = is_study_sponsor_trusted(row)
    print(f'  → is_study_sponsor_trusted: {trusted}')
    print()

# also check which portfolio tickers are missing entirely
present = {str(r.get('ticker','')).strip().upper() for r in rows}
missing = PORTFOLIO - present
print(f'Portfolio tickers MISSING from clinical_simulation_snapshot: {sorted(missing)}')
