"""Search transcript for truncated orchestrator tail."""
import json
import re
from pathlib import Path

transcript = Path(
    r"C:\Users\tizyv\.cursor\projects\c-Users-tizyv-OneDrive-Desktop-coding-Biotech-Investment-app-6"
    r"\agent-transcripts\a589cd46-d8d0-4001-940b-61670d520ad9"
    r"\a589cd46-d8d0-4001-940b-61670d520ad9.jsonl"
)
out = Path(r"C:\coding\Biotech_Investment app 6\_find_tail_result.txt")
needles = [
    "def regenerate_simulation_sheet_quick",
    "def _run_simulation_sheet_into_workbook",
    "def _write_accuracy_simulation_sheet",
]
found = {n: [] for n in needles}
if transcript.is_file():
    with transcript.open(encoding="utf-8", errors="replace") as fh:
        for i, line in enumerate(fh, 1):
            if "def regenerate_simulation" not in line and "def _run_simulation" not in line:
                if "def _write_accuracy_simulation" not in line:
                    continue
            for n in needles:
                if n in line:
                    found[n].append(i)
lines = []
for n, hits in found.items():
    lines.append(f"{n}: {hits[:5]}")
out.write_text("\n".join(lines) or "no hits", encoding="utf-8")
