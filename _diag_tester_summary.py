import urllib.request
import json

BASE = "http://91.99.15.48:8765"

with urllib.request.urlopen(BASE + "/api/tester-feedback/summary", timeout=15) as r:
    data = json.loads(r.read().decode("utf-8"))

print(f"tester_count: {data.get('tester_count')}")
print(f"approved_testers: {data.get('approved_testers')}")
print(f"pending_testers: {data.get('pending_testers')}")
print(f"updated_at: {data.get('updated_at')}")
print()
for t in data.get("testers", []):
    print(
        f"  {t.get('email','?'):40s} {t.get('display_name','?'):20s} "
        f"status={t.get('status'):10s} source={t.get('source', '?'):8s} "
        f"created={str(t.get('created_at','?'))[:19]}"
    )
