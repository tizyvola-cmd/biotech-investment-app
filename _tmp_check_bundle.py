from pathlib import Path

p = Path("/opt/biotech/desktop-ui/dist/assets/index-DpVg0htD.js")
print("exists", p.is_file(), "size", p.stat().st_size if p.is_file() else 0)
t = p.read_text(encoding="utf-8", errors="ignore") if p.is_file() else ""
checks = [
    "premium.unlock.discovery",
    "Join the beta waitlist",
    "First 1,000 members get 12 months free",
    "Unlock premium membership to discover",
]
for c in checks:
    print(c, c in t)
