---
name: testing-learning-lab-ui
description: Test desktop-ui Learning Lab / Model Calibration UI (e.g. ChannelImpactPanels, the 3-channel impact tab) end-to-end. Use when verifying frontend changes in desktop-ui when the FastAPI backend or local data/ is unavailable.
---

# Testing the Learning Lab / Model Calibration UI

## What this covers
The desktop-ui "Calibrazione modello" tab (`LearningLabView.tsx`, `topTab === "model"`)
and its components, notably `ChannelImpactPanels.tsx` (3 panels: Predizione /
Raccomandazione / Trading), driven by `overview.channel_impact`.

## Key constraint: backend often not runnable on a fresh clone
The full app needs the FastAPI backend (`uvicorn supernova_api:app --port 8765`) plus
the user's `data/` directory. A fresh clone usually has **neither** (`fastapi` not in
the system Python; `data/` gitignored). Installing the whole backend dep set just to
render one tab is high-effort/low-fidelity (panels show empty states without data).

## Recommended approach: temporary Vite component harness
Render the **real** component with realistic props + the app's real theme. This tests
the exact deliverable UI without the backend. Steps:

1. Create `desktop-ui/devtest.html` (untracked) with a `<div id="root">` and
   `<script type="module" src="/src/__devtest_channel.tsx">`.
2. Create `desktop-ui/src/__devtest_channel.tsx` (untracked) that:
   - imports `"./index.css"` and `"./styles/themes.css"` (REQUIRED — otherwise tailwind
     tokens like `text-ink`, `bg-surface`, CSS vars won't style anything),
   - imports the component under test (e.g. `ChannelImpactPanels`),
   - mounts it via `createRoot` with realistic data mirroring `diag_loop_channel_impact.py`
     output. Render multiple states (populated, "collecting"/empty, no-data).
3. Run `npx vite --host 127.0.0.1 --port 5191` and open
   `http://127.0.0.1:5191/devtest.html`.
4. **Delete both temp files** when done (they're untracked; do not commit them).

The dev server proxies `/api` → `127.0.0.1:8765` (`vite.config.ts`), so if you DO have a
backend running you can test the full app instead; otherwise the harness is the path.

## What to assert (3-channel tab specifically)
- **Prediction:** magnitude loops must render as guardrails, NOT levers — verdict pills
  `peggiora` / `impatto ≈0` / `non misurabile`; `daily_curve_recalib` = `leva direzione`.
  (This is the whole point of the redesign — if magnitude loops show as levers, it's broken.)
- **Recommendation:** action lift vs book is color-coded (positive green, negative red);
  when no entry SDS yet, an "in raccolta" badge + note shows while the other 2 panels stay
  populated (graceful degradation).
- **Trading:** P&L mean/median/win-rate/total€ + recent weekly rows + sparkline.
- **Trading by-regime breakdown** (`trd.regimes`): a "P&L per regime d'ingresso" block lists
  one row per regime (`RISK_ON` / `NEUTRAL` / `RISK_OFF` / `CRISIS`) as `n · win% · P&L · lift`,
  with `lift_vs_book_pp` color-coded green if >0 / red if <0 (same convention as the
  Recommendation lift). When `regime_available=false` / `regimes=[]` it must show the italic
  "In raccolta… il regime d'ingresso si popola sui nuovi trade chiusi" note instead of empty
  rows, while the other Trading metrics stay populated. Only known regimes are surfaced
  (UNKNOWN/empty-regime rows are excluded but still counted in the whole-book baseline).
- **No-data:** `data={undefined}` → "Per-channel impact unavailable…" message, no crash.

## Backend sanity (no GUI needed)
The Python compute is unit-tested: `pytest tests/prediction_core/test_learning_loop_channels.py`.
Quick manual check (no data required, returns empty but must not error):
```bash
python3 -c "from prediction.learning_loop_channels import compute_channel_impact; print(compute_channel_impact().keys())"
```
A live full-stack check requires a sim rebuild so positions carry entry SDS/regime:
`python scripts/investment_sim_outcomes.py` then the weekly snapshot persists to
`data/learning_loop_weekly_impact.json` (also written on every `post_refresh_steps` run).
Note: regime/SDS attribution (Recommendation actions, Trading by-regime) only populates for
trades that carry `entry_regime`/`entry_sds_score`; historical closed trades lack these, so
live these sections show "collecting" until new cycles close after the logging change.

## Lint / typecheck gates
- Frontend: `cd desktop-ui && npx tsc -b` (no eslint config in repo; tsc is the gate).
- Backend: `ruff check <files>` and `pytest tests/prediction_core/...`.

## Devin Secrets Needed
None for the harness approach (purely local). A full live test would need the user's
`data/` and a running backend, which live only on the user's machine.
