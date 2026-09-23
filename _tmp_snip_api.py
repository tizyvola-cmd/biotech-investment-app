from pathlib import Path

text = Path("/opt/biotech/supernova_api.py").read_text(encoding="utf-8")
start = text.find("async def desk_competition_landscape_lookup")
print("---LOOKUP---")
print(text[start : start + 1400])
print("---LIFESPAN---")
idx = text.find("async def _lifespan")
print("idx", idx)
print(text[idx : idx + 3500])
