import re
from pathlib import Path

p = Path("/opt/biotech/supernova_api.py")
text = p.read_text(encoding="utf-8")
print("lines", text.count("\n"))
print("cache_only", "cache_only" in text)
print("warm_desk", "warm_desk_competition" in text)
print("health_pg", "supernova_pg.healthcheck" in text)
routes = re.findall(r'@application\.(get|post|put|delete)\("([^"]+)"', text)
print("routes", len(routes))
for method, path in routes:
    print(f"{method} {path}")
