#!/usr/bin/env python3
from pathlib import Path
p = Path("/opt/biotech/daily_news_desk.py")
text = p.read_text(encoding="utf-8")
print("has_gemini_attach", "_attach_8k_gemini_paragraphs" in text)
print("schema6", "_BRIEF_SCHEMA = 6" in text)
print("sec_8k_gemini", "sec_8k_gemini" in text)
