from pathlib import Path
import re

p = Path("/opt/biotech/desktop-ui/dist/index.html")
html = p.read_text(encoding="utf-8")
stamp = "2026-09-17T10:07Z-signin"
if 'name="sn-build"' in html:
    html = re.sub(
        r'<meta name="sn-build" content="[^"]*" />',
        f'<meta name="sn-build" content="{stamp}" />',
        html,
        count=1,
    )
else:
    html = html.replace(
        "<head>",
        f'<head>\n    <meta name="sn-build" content="{stamp}" />',
        1,
    )
p.write_text(html, encoding="utf-8")
print("stamped", stamp)
print(html[html.find("index-") : html.find("index-") + 24])
