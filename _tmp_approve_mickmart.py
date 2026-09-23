#!/usr/bin/env python3
"""Register + approve mickmart@gmail.com for desktop Deep Dive access."""
from __future__ import annotations

import sys

sys.path.insert(0, "/opt/biotech")
import tester_feedback_io as tf

EMAIL = "mickmart@gmail.com"
meta = tf.register_tester(
    "",
    email=EMAIL,
    display_name="Michele",
    first_name="Michele",
    last_name="Mart",
    birth_year=1980,
    source="desktop",
    interest_edition="biotech",
    interest_other="biotech catalyst desk",
)
tid = str(meta.get("tester_id") or tf._tester_id_from_email(EMAIL))
print("registered", tid, meta.get("status"), meta.get("email"))
out = tf.set_tester_status(tid, "approved", note="Owner approved — Deep Dive product sheet access")
print("approved", out.get("status"), "allowed", out.get("allowed"), "email", out.get("email"))
# Issue a session so first login is smoother (optional — client will re-issue).
token = tf.issue_tester_session(tid)
print("session_issued", bool(token), "len", len(token))
access = tf.get_tester_access(tid)
print("access", access)
