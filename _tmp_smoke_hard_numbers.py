#!/usr/bin/env python3
import sys
sys.path.insert(0, "/opt/biotech")
from daily_news_desk import _extract_hard_numbers
body = (
    "The company announced a $50 million partnership with Acme Bio. "
    "The Phase 2 study has 270 patients enrolled. "
    "On 17 September 2026 management will present at the conference."
)
print(_extract_hard_numbers(body))
print("tape", _extract_hard_numbers(
    "HOC NEWS At the close on September 18, 2026, Biogen stock finished at USD 215.50 on Nasdaq, down 1.62 percent"
))
