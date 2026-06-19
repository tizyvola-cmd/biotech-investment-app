#!/usr/bin/env python3
"""Launcher CLI per ``refresh_fast.py`` (stesso pattern di launch_refresh_sim_accuracy_grafici)."""
from __future__ import annotations

import sys

from refresh_fast import main

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
