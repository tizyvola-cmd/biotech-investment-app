import json, urllib.request
body = {
  "tester_id": "alexross1948_at_gmail.com",
  "module": "dashboard",
  "kind": "ui_error",
  "source": "desktop",
  "display_name": "Alessandro",
  "payload": {"label": "probe", "message": "manual probe from ops"},
}
req = urllib.request.Request(
  "http://127.0.0.1:8765/api/tester-feedback/events",
  data=json.dumps(body).encode(),
  headers={"Content-Type": "application/json"},
  method="POST",
)
print(urllib.request.urlopen(req).read().decode()[:800])
