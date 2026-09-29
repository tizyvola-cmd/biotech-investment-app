import urllib.request
import json

BASE = "http://91.99.15.48:8765"


def get_json(path):
    with urllib.request.urlopen(BASE + path, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


summary = get_json("/api/tester-feedback/summary")
print(f"Total testers: {summary.get('tester_count')}")
print()
for t in summary.get("testers", []):
    tid = t.get("tester_id", "")
    print(f"=== {t.get('email','?')} ===")
    print(
        f"  id: {tid}   status: {t.get('status')}   allowed(from summary): —"
    )
    try:
        access = get_json(f"/api/tester-feedback/testers/{tid}/access")
        print(
            f"  /access response: registered={access.get('registered')} "
            f"status={access.get('status')} allowed={access.get('allowed')}"
        )
    except Exception as exc:
        print(f"  /access error: {exc}")
    print()
