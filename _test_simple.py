from pathlib import Path
Path("_test_simple_out.txt").write_text("step1\n", encoding="utf-8")
import sys
sys.path.insert(0, ".")
Path("_test_simple_out.txt").write_text("step2\n", encoding="utf-8")
from orchestrator_io_paths import DATA_DIR
Path("_test_simple_out.txt").write_text(f"step3 DATA_DIR={DATA_DIR}\n", encoding="utf-8")
