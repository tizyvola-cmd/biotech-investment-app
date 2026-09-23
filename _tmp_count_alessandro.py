#!/usr/bin/env python3
"""Separate Alessandro vs owner activity via tester-feedback paths."""
import subprocess, re, json
from collections import Counter

out = subprocess.check_output(
    ["journalctl", "--since", "2 hours ago", "--no-pager"],
    text=True,
    errors="replace",
)
alex = Counter()
other = Counter()
all_from_ip = Counter()
for l in out.splitlines():
    if "93.47.41" not in l:
        continue
    m = re.search(r'"(GET|POST|PUT) ([^ ]+)', l)
    if not m:
        continue
    path = m.group(2).split("?")[0]
    all_from_ip[path] += 1
    if "alexross" in path:
        alex[path] += 1
    elif "tester-feedback" in path:
        other[path] += 1

print("=== alexross paths ===")
for k, v in alex.most_common(20):
    print(f"{v:5d}  {k}")
print("=== other tester-feedback from same IP ===")
for k, v in other.most_common(20):
    print(f"{v:5d}  {k}")
print("=== top all from IP ===")
for k, v in all_from_ip.most_common(15):
    print(f"{v:5d}  {k}")

# Peek store for alexross events
import os
cands = [
    "/root/Biotech_Investment app 6/data/tester_feedback_store.json",
    "/opt/supernova/data/tester_feedback_store.json",
]
r = subprocess.check_output(
    "find /root /opt /home /var -name 'tester_feedback*.json' 2>/dev/null | head -20",
    shell=True,
    text=True,
)
print("stores:", r)
