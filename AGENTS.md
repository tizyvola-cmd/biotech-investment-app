# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

Python-first **SuperNova / Biotech Investment** repo: local FastAPI (`supernova_api.py` on **127.0.0.1:8765**), large `data_orchestrator.py` pipeline, and partial `prediction/` modules. Documented Electron + React UI (`desktop-ui/`, `electron/`) is **not** in this git tree.

### Services (dev)

| Service | Command | Port |
|---------|---------|------|
| **SuperNova API** (required for API/UI E2E) | `.venv/bin/python -m supernova_api` | 8765 |
| **Vite UI** (optional; not in repo) | `cd desktop-ui && npm run dev` | 5173 |
| **Electron** (optional; not in repo) | `cd electron && npx electron main-modern.cjs` | — |

Use **tmux** for long-running servers (see Cloud Agent shell rules).

### Setup / dependencies

From repo root (see `requirements-*.txt`):

- `.venv/bin/pip install -r requirements-core.txt` — orchestrator (pandas, openpyxl, yfinance, …)
- `.venv/bin/pip install -r requirements-dev.txt` — API + pytest (includes `requirements-electron.txt`)

The VM **update script** runs both installs on startup.

### Lint

No linter (ruff/flake8/mypy/eslint) is configured in this repository.

### Tests

```bash
.venv/bin/python -m pytest tests/test_simulation_preserve.py \
  tests/prediction_core/test_supernova_config.py \
  tests/prediction_core/test_supernova_api.py \
  tests/prediction_core/test_extrap_safeguards.py -q
```

Most of `tests/prediction_core/` imports missing `prediction.*`, `excel_sheet_reader`, `past_pred_io`, etc. Expect collection errors if you run the full suite without the full private codebase.

### API smoke check

```bash
curl -s http://127.0.0.1:8765/api/health
curl -s http://127.0.0.1:8765/api/status
```

`/api/status` needs `refresh_fast_status.py` (present in repo). Sheet routes need `excel_sheet_reader` (not in this tree).

### Orchestrator

`python data_orchestrator.py` needs many modules not committed here (`variation_colors`, fetch scripts, most of `prediction/`). Do not assume full pipeline runs in this checkout.

### Paths module

`orchestrator_io_paths.py` defines `data/` paths (`FINAL_XLSX`, JSON locations, venv python). Workbook/JSON under `data/` are gitignored.
