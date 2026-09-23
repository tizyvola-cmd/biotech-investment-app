#!/usr/bin/env python3
"""Warm Daily News briefs for current top/highlights (server-side Gemini)."""
import sys
sys.path.insert(0, "/opt/biotech")
from daily_news_desk import load_daily_news, prefetch_daily_news_briefs

doc = load_daily_news()
rows = []
for key in ("top_news", "highlights"):
    for r in doc.get(key) or []:
        if isinstance(r, dict):
            rows.append(r)
# Prefer top first
print("rows", len(rows))
stats = prefetch_daily_news_briefs(rows, max_items=12)
print(stats)
