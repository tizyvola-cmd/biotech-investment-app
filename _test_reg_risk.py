import sys, json
sys.path.insert(0, ".")
from scripts.regulatory_risk_refresh import build_regulatory_risk_snapshot, save_snapshot

snap = build_regulatory_risk_snapshot()
save_snapshot(snap)
print("ticker_count:", snap.get("ticker_count", 0))
print("signal_count:", snap.get("signal_count", 0))
tickers = list(snap.get("tickers", {}).keys())
print("tickers_with_signals:", tickers[:10])
for tk in tickers[:3]:
    entry = snap["tickers"][tk]
    print(f"  {tk}: score={entry.get('score',0)} crl={entry['crl']['detected']} pdufa={entry['pdufa']['detected']} cmc={entry['cmc']['detected']}")
