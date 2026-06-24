from pathlib import Path

p = Path(__file__).resolve().parents[1] / "prediction" / "pipeline.py"
text = p.read_text(encoding="utf-8")
needle = "    orch = _orch()\n    _options_signals = options_signals"
repl = (
    "    orch = _orch()\n"
    "    _VERSIONS = getattr(\n"
    "        orch,\n"
    '        "_VERSIONS",\n'
    '        ["v1_momentum", "v2_signals", "v3_ensemble", "v4_options"],\n'
    "    )\n"
    "    import os\n"
    "\n"
    '    _ows = os.environ.get("ORCH_OPTIONS_WORKERS", "").strip().lower()\n'
    "    _options_signals = options_signals"
)
if "_VERSIONS = getattr" in text:
    print("already patched")
elif needle not in text:
    raise SystemExit("needle not found")
else:
    p.write_text(text.replace(needle, repl, 1), encoding="utf-8")
    print("patched")
