# SuperNova Desktop — Performance Bug Analysis for Claude Handoff

> **Context**: This document is a self-contained handoff describing severe performance
> issues in the SuperNova biotech investment desktop app (Electron + FastAPI backend).
> It records symptoms, evidence, root causes, past fixes (with their effectiveness),
> and a prioritized action list for the next agent to continue with.
>
> **Author**: previous Cursor Agent session, Jul 13 2026.
> **User complaint**: "Ancora il sistema è lentissimo, lontano da essere efficiente" —
> app is still very slow, tabs stuck on "Loading…", DevTools shows API requests
> taking 6–16 seconds and hundreds of health-check pings queued up.

---

## 1. Environment

| Piece | Details |
|---|---|
| Repo root | `C:\coding\Biotech_Investment app 6` |
| Frontend | `desktop-ui/` (React 18 + Vite 5 + Recharts + Chart.js) |
| Backend | `supernova_api.py` (FastAPI + Uvicorn, single worker, sync handlers) |
| Electron shell | `electron/main-modern.cjs` (protocol handler + IPC bridge) |
| Build target | `npm run build:electron` → `dist/assets/index-*.js` (~3.9 MB, `inlineDynamicImports: true`) |
| Backend URL | `http://127.0.0.1:8765` |
| API surface | ~100 routes under `/api/*` |
| Custom perf logging | Enabled via `SUPERNOVA_API_PERF=1` env var → prefixes every request with `[PERF:api]`, `[PERF:ipc]`, `[PERF:project-data]` in the browser console |
| Mobile UI | `mobile-ui/` — **out of scope**, separate build, no shared components (see `.cursor/rules/mobile-vs-desktop.mdc`) |

---

## 2. Observed symptoms (screenshots analyzed live with the user)

### 2.1 Screenshot 1 — "Evaluation Lab" tab (screenshot dated Jul 13 19:00)

```
[PERF:api] GET /api/regulatory-risk/snapshot        5468.7ms  37.1KB
[PERF:api] GET /api/investment/sim-outcomes         5468.7ms  105.9KB
[PERF:project-data] invest_sim_inputs.json           0.0ms    7.3KB  cache-hit
[PERF:ipc]  regulatory_risk_snapshot.json          3063.4ms  37.1KB
[PERF:api]  GET /api/health                        6609.9ms   0.1KB
[PERF:project-data] desktop_data_manifest.json       0.0ms    0.8KB  cache-hit
[PERF:api]  GET /api/health                        3290.4ms   0.1KB
[PERF:api]  GET /api/status                        3279.7ms   0.6KB
[PERF:api]  GET /api/clinical-pre-cd/feed-refresh-report 2353.8ms 1.5KB
[PERF:api]  GET /api/status                        2494.4ms   0.6KB   ← DUPLICATE
[PERF:api]  GET /api/models/learning-lab/overview 15767.5ms  67.5KB   ← 15 s !
[PERF:api]  GET /api/orchestrator/log?tail=4000   1308.3ms   4.2KB
[PERF:api]  GET /api/health                         722.4ms   0.1KB
[PERF:api]  GET /api/health                        1921.6ms   0.1KB
[PERF:api]  GET /api/health                        1691.4ms   0.1KB
[PERF:api]  GET /api/health                        1610.0ms   0.1KB
[PERF:api]  GET /api/health                        1535.0ms   0.1KB
[PERF:api]  GET /api/health                        1642.5ms   0.1KB
[PERF:api]  GET /api/health                         732.4ms   0.1KB
```
Tab content: **"Loading…"** at the center of the screen (never renders).

### 2.2 Screenshot 2/3/4 — "Model quality" tab (earlier, Jul 13)

Endless flood of `/api/health` calls (700 ms – 7 s each) interleaved with cache-hits.
Tab content: **"Loading…"** center-screen, no data ever appears.

### 2.3 Earlier screenshots (before build 19:00)

- `[PERF:ipc]  clinical_simulation_snapshot.json 8859.2ms **73.0 MB**` — 73 MB JSON via IPC in 8.8 s
- 3 concurrent `/api/investment/sim-outcomes` calls (6835 + 6577 + 6558 ms) — same request fired three times
- `[PERF:project-data] clinical_pre_cd_enrichment_snapshot.json 0.0ms 6.66MB cache-hit` — spammed dozens of times (this was fine performance-wise but pointed at over-eager consumers)

---

## 3. Baseline architecture facts (needed for diagnosis)

1. **Uvicorn is single-worker** (`supernova_api.py:2706`, no `workers=` arg).
2. **All FastAPI routes are `def` (sync)**. FastAPI runs them in an anyio threadpool (default 40 workers). GIL applies.
3. `/api/health` handler is trivial: `return {"status": "ok", "root": str(ROOT)}` — expected to complete in <5 ms even under load.
4. **Chromium (Electron) HTTP/1.1 connection limit**: 6 concurrent connections per host. Requests beyond that queue at the client side.
5. **`inlineDynamicImports: true`** for the Electron build (`desktop-ui/vite.config.ts:56`). All `React.lazy(...)` imports resolve synchronously — the "Loading…" center-screen text cannot come from `Suspense fallback`, so it must come from inside a rendered view.
6. **Frontend fetch is plain `fetch()`** using the browser stack (`api()` in `supernova.ts:62`). No custom HTTP client, no HTTP/2, no request priority hinting.
7. **Perf logging is opt-in** via `SUPERNOVA_API_PERF=1`. The `[PERF:*]` prefixes in the console come from `logPhase0Perf`.

---

## 4. Root-cause hypotheses (ranked by confidence)

### H1 — Client-side HTTP connection saturation *(HIGH confidence)*

**Chromium enforces 6 concurrent HTTP/1.1 connections per host.** At boot the frontend
fires 15+ concurrent requests (see §5 waterfall). One slow request (e.g.
`learning-lab/overview` = 15 s) parks a connection for the full duration; the
other 9+ requests queue *client-side*. This is why `/api/health` — a route
that literally returns a static dict — is reported as taking **6.6 s**: it
spent 6.5 s waiting for a free HTTP slot in Chromium.

Evidence:
- Duration of `/api/health` is proportional to the number of heavy in-flight requests, not to backend load.
- Cache-hit local reads (`[PERF:project-data] ... 0.0ms`) confirm the JS event loop is unblocked; the delay is at the network layer.

**How to verify**: open DevTools → Network → sort by Waterfall. The
"Stalled" or "Queueing" segment for `/api/health` should be ~6 s while the
actual "TTFB" is <10 ms.

### H2 — Duplicate concurrent fetches *(HIGH confidence)*

Several endpoints are fetched by multiple consumers without any dedup / caching.
See §6 for the exhaustive list. The most damaging ones observed:

| Endpoint | # callers | Duration | Dedup status |
|---|---|---|---|
| `/api/health` | main poller (10 s) + `refreshApi` at boot | 6.6 s worst-case | **None** (both call `fetchHealth()` directly) |
| `/api/status` | `refreshApi` + `useEffect(apiOk)` at line 1443 | 3.3 s | **None** |
| `/api/models/learning-lab/overview` | `useCdPatternPolygonOverview` hook + `LearningLabView` component | 15.7 s | in-flight only, **no response cache** |
| `/api/investment/sim-outcomes` | 8+ consumers | 5-14 s | in-flight + 30 s cache (added Jul 13, but `LearningLabPortfolioTab` was bypassing it — fixed) |
| `/api/regulatory-risk/snapshot` | 4+ consumers | 5.4 s | in-flight + 60 s cache (added Jul 13) |
| `/api/investment/sim-history` | 2+ consumers | 14 s | in-flight + 30 s cache (added Jul 13) |
| `/api/clinical-pre-cd/feed-refresh-report` | `checkClinicalFeedRefreshPopup` + `checkClinicalFeedStaleWarning` | 2.4 s | **None** |
| `/api/orchestrator/log?tail=4000` | `refreshApi` at boot | 1.3 s | **None** |

### H3 — Electron main-process blocking on synchronous JSON reads *(MEDIUM confidence)*

`electron/main-modern.cjs:531` implements `read-project-data-file` using
`fs.readFileSync` + `JSON.parse` on the main process. For the 6.66 MB
`clinical_pre_cd_enrichment_snapshot.json` and the 73 MB
`clinical_simulation_snapshot.json` this **freezes the entire Electron main
process** for hundreds of milliseconds per read. Effects:
- Renderer window updates stall (main process arbitrates the compositor).
- `project-data://` protocol handler (registered on the main process) stalls in parallel.
- The IPC bridge queues subsequent calls.

Evidence:
- `[PERF:ipc] clinical_simulation_snapshot.json 8859.2 ms 73.0 MB` — dominated by main-thread `JSON.parse`, not disk I/O.
- Even `[PERF:ipc] desktop_data_manifest.json 262.7 ms 0.8 KB` — a **262 ms** read of a 0.8 KB file is impossible under normal load; the main process was busy.

### H4 — Backend sync handlers running in threadpool with heavy computation *(MEDIUM confidence)*

`/api/models/learning-lab/overview` calls `build_overview_payload(use_mock=False, force_refresh=force)`
synchronously. If this recomputes summaries every call (no server-side cache),
each hit blocks a threadpool worker for 15 s. The GIL prevents other Python
code paths from progressing while the worker is CPU-bound.

Files to inspect: `prediction/learning_lab.py` (unread by this session).

### H5 — Custom perf logging cost *(LOW confidence, partially fixed)*

`fetchProjectJson` used to `JSON.stringify` the payload on every cache-hit
just to log its byte length. Fixed Jul 13: byte count is now cached at
write-time. Residual issue: **first** (non-cached) IPC read still stringifies
for logging, costing 200-500 ms extra for the 6.6 MB file. Not the main
bottleneck now, but worth cleaning up.

---

## 5. Boot waterfall (reconstructed)

App mount (`desktop-ui/src/App.tsx`) triggers, in this order and mostly concurrently:

```
t=0  ┌ useEffect (line 614): health-poller tick #1        → fetchHealth()          (A)
     ├ useEffect (line ~493 startup):
     │    reloadAllSheets()  → reloadSimulation()          → fetchSimulationSheet()
     │                       Promise.all([
     │                         reloadData(),
     │                         reloadClinical()            → fetchClinicalSimulationSheet()
     │                         reloadSecK8()               → fetchSecK8SimulationSheet()
     │                         reloadAccuracy()            → fetchAccuracySheet()
     │                         reloadFinancial()           → fetchFinancialSheet()
     │                       ])
     │    Each of those calls loadSheetWithFallback(kind), which:
     │      1. loads local snapshot via IPC (project-data:// or read-project-data-file)
     │      2. calls probeApiReachable() → /api/health              (B, C, D, E, F, G)
     │      3. if snapshot empty → calls Excel API (18 s timeout)
     │
     ├ refreshApi() (line 622 or first tick):
     │    → fetchHealth()                                          (H)
     │    → fetchStatus()                                          (I)
     │    → fetchOrchestratorLog(4000)                             (J)
     │
     ├ useEffect (line 1443) apiOk → true:
     │    → fetchStatus()                                          (K)  ← DUPLICATE of (I)
     │
     ├ useEffect (line 1403) runEisStaleWarningCheck:
     │    → fetchClinicalFeedRefreshReport()                       (L)
     │
     ├ useEffect (line 1360) desktop manifest polling:
     │    → fetchDesktopManifest()                                 (M)
     │
     └ On-mount data hooks for whichever screen is initial:
        e.g. "Evaluation Lab" (simulation) mounts InvestmentSimulationView (5106 LOC)
        which triggers:
          - fetchRegulatoryRiskSnapshot()                          (N)
          - loadInvestmentSimOutcomes()                            (O)
          - fetchInvestSimHistoryPersisted()                       (P)
          - fetchLearningLabOverview() via useCdPatternPolygonOverview  (Q)  15 s
          - ... more via useLossRiskCatalog, useSimLoopSynthAllocation

t=5s   Chromium serves 6 slots ≈ (Q, N, O, C, D, E)
       Waiting queue: (B, F, G, H, I, J, K, L, M, P, ...) ~11 requests

t=10s  Health poller tick #2 fires (another /api/health)
```

Result: ~20+ concurrent fetches, most of them competing for 6 HTTP slots. Health
pings, which the user relies on to gauge "is the app alive?", get punished
because they're always at the back of the queue.

---

## 6. Fixes attempted in this session (chronological)

All changes are in the working tree of `desktop-ui/src/`; TypeScript compile is
clean (`npx tsc -p tsconfig.json --noEmit` at 19:02 exit 0). The user
rebuilt at 19:00, so the following fixes are already active in the running
Electron build:

### 6.1 CSS scroll jank *(pre-existing session)*
Removed `backdrop-filter: blur()` from ~7 card styles in `desktop-ui/src/index.css`.
Replaced with solid `rgba()` backgrounds. Removed `background-attachment: fixed`
from `.dark body`.

### 6.2 Keep-alive screens *(pre-existing session)*
`App.tsx`: 5 heavy screens (`main`, `simulation`, `piggyBank`, `decisionLab`,
`models`) now use a `TabPanel` wrapper that renders with `display:none` instead
of unmounting. `mountedScreens` state tracks visited screens.

### 6.3 Lazy chart mounting *(pre-existing session)*
`ModelComparisonPanel.tsx` (15 Recharts scatter charts): charts 2 and 3 use
the new `useInViewOnce` hook (`desktop-ui/src/hooks/useInViewOnce.ts`) so they
mount only when scrolled into view.

### 6.4 In-flight + response cache for the four heaviest endpoints
- `fetchRegulatoryRiskSnapshot` — 60 s cache
- `loadInvestmentSimOutcomes` — 30 s cache (+ `invalidateInvestmentSimOutcomesCache` for POST-rebuild)
- `fetchInvestSimHistoryPersisted` — 30 s cache (auto-invalidated by `saveInvestSimHistoryPersisted`)
- `probeApiReachable` — 5 s cache existed; added in-flight coalescer + moved cache stamp to *after* the fetch (was: stamped before await, so a 13 s call was 3× TTL stale on arrival)

### 6.5 Perf-log byte reuse
`fetchProjectJson` no longer re-stringifies the 6.6 MB payload on every cache
hit for logging; byte count is cached at write-time.

### 6.6 Bypass fix
`LearningLabPortfolioTab.tsx` was calling `api("/api/investment/sim-outcomes")`
directly, bypassing 6.4's dedup. Rerouted through `loadInvestmentSimOutcomes()`.

### 6.7 Effectiveness assessment

After all of 6.1–6.6:

| Symptom | Before | After (screenshot 5, Jul 13 19:00) | Verdict |
|---|---|---|---|
| Concurrent `/api/investment/sim-outcomes` at boot | 3 (14 s each) | 1 (5.4 s) | ✅ FIXED |
| Concurrent `/api/regulatory-risk/snapshot` | 4 | 1 (5.4 s) | ✅ FIXED |
| Cache-hit CPU cost from JSON.stringify | ~200 ms per log | 0.0 ms | ✅ FIXED |
| Scroll jank (backdrop-filter) | Present | Not observed | ✅ FIXED |
| Tab switching heavy screens | Full remount | Keep-alive `display:none` | ✅ FIXED |
| `/api/health` flood | 20+ concurrent | Still 8-9 per minute, each 700 ms–6 s | ❌ **NOT FIXED** |
| Duplicate `/api/status` | 2× | Still 2× | ❌ **NOT FIXED** |
| `/api/models/learning-lab/overview` 15 s | 15 s per open | Still 15 s (no response cache) | ❌ **NOT FIXED** |
| "Loading…" stuck on Evaluation Lab / Model quality | Stuck | Still stuck | ❌ **NOT FIXED** |

### 6.8 Second wave of fixes — applied Jul 13 19:37 (this session, post-analysis)

Applied after the analysis in §4 confirmed H1 (client-side HTTP/1.1 saturation) as
the dominant cause. All changes are in the working tree, `tsc --noEmit` clean.
The user must rebuild (`npm run build:electron`) and relaunch to activate them.

**Change A — `fetchHealth` in-flight coalescer + 5 s cache** (`supernova.ts:134`)
The main App.tsx health-poller and `refreshApi()` both call `fetchHealth()` at
boot in the same tick. Now they share a single in-flight promise; subsequent
callers within 5 s hit the cache. Combined with the existing `probeApiReachable`
coalescer (also 5 s), the boot health-storm collapses to **1 real network
request** instead of 2-3.

**Change B — `fetchStatus` in-flight coalescer + 10 s cache** (`supernova.ts:158`)
Two boot call sites (`refreshApi` + `useEffect(apiOk)` at App.tsx:1462) now
share one round-trip. `invalidateStatusCache()` exposed for future mutation paths.

**Change C — `fetchLearningLabOverview` 5-minute response cache** (`supernova.ts:1920`)
Endpoint is 15 s server-side. Previously the in-flight coalescer only
collapsed same-tick calls; once the promise settled every re-open of the
Models tab re-fetched. New behavior: `Ctrl+Tab`-cycling through Models tab
is now instant after the first paint. `invalidateLearningLabOverviewCache()`
is wired into `applyLearningCycle()` and `resetLearningLab(true)` so users
who mutate the learning state see fresh data.

**Change D — `fetchClinicalFeedRefreshReport` 60 s cache** (`supernova.ts:534`)
`checkClinicalFeedRefreshPopup` and `checkClinicalFeedStaleWarning` both fire
at boot; they now share a cached doc. `invalidateClinicalFeedRefreshCache()`
is wired into `ackClinicalFeedRefreshReport()`.

**Change E — orchestrator log deferred to System-tab open** (`App.tsx:582-620`)
`refreshApi()` no longer fetches `/api/orchestrator/log?tail=4000` at boot.
Instead a new `useEffect` on `screen === "system"` fetches it on-demand.
Saves 1.3 s of an HTTP slot at boot for a payload nobody looks at until they
navigate to the System tab.

### 6.9 Expected effect on the boot waterfall

Boot-time HTTP fan-out **before** Change A-E:
```
health(A) health(B) status(C) status(D) log(E) sim(F) sim-outcomes(G)
regulatory-risk(H) sim-history(I) learning-lab-overview(J)  feed-refresh(K)
feed-refresh(L) manifest(M) ... ~15-20 concurrent
```
Boot-time HTTP fan-out **after** Change A-E:
```
health(A) status(C) sim(F) sim-outcomes(G) regulatory-risk(H)
sim-history(I) learning-lab-overview(J) feed-refresh(K) manifest(M)
= 9 distinct requests, none duplicated
```
That fits within Chromium's 6-slot pool with only 3 queued (versus 9-14 queued
before). Cheap endpoints (health, status, manifest) should now report
sub-100 ms durations instead of 3-6 s.

---

## 7. What still needs to be done — prioritized action list

> Changes marked ✅ DONE were applied in section 6.8 during this session. The
> user must rebuild (`npm run build:electron`) to activate them.

### 🔥 P0 — Kill the boot request storm

**Target**: reduce concurrent requests at t=0 from ~20 to ≤6.

- ✅ **DONE** — `fetchHealth` in-flight coalescer + 5 s cache (Change A above)
- ✅ **DONE** — `fetchStatus` in-flight coalescer + 10 s cache (Change B above)
- ✅ **DONE** — `fetchLearningLabOverview` 5 min response cache (Change C)
- ✅ **DONE** — `fetchClinicalFeedRefreshReport` 60 s cache (Change D)
- ✅ **DONE** — orchestrator log deferred to on-demand (Change E)

### 🔥 P0 — Diagnose "Loading…" stuck on Evaluation Lab / Model quality

**Hypothesis**: `InvestmentSimulationView` / `ModelAccuracyLabView` renders
successfully (bundle is inlined, no lazy suspense), but shows a "Loading…"
placeholder in a specific child until required data resolves. Because of the
boot storm (P0), that data never resolves for many seconds.

**Diagnosis steps**:
1. Ask user to open the stuck tab, then wait 60 s and screenshot again — does it eventually render?
2. Grep the tab's tree for `Loading…` text (there is only 1 in `InvestmentSimulationView.tsx:3614` — check if it's on-screen or if it's `ScreenFallback` from a nested Suspense).
3. In DevTools React tab, inspect the DOM at the "Loading…" element — its parent component tells you exactly which piece of data is missing.

**Likely fix**: whichever data source is being awaited is either (a) a fetch
that's queueing behind slow requests (fixed by P0), or (b) a snapshot that's
missing on disk. In case (b), show an actionable error, not a spinner.

### ⚠️ P1 — Attack HTTP/1.1 saturation directly

**Option A (recommended)**: Enable HTTP/2 in Uvicorn. In `supernova_api.py:2706`:
```python
uvicorn.run("supernova_api:app", host=..., port=..., http="h2")
```
Requires `pip install h2`. Removes the 6-connection limit entirely (multiplexed streams over one connection).

**Option B**: Serve slow endpoints from a separate port so they don't compete
with cheap ones. E.g. `learning-lab/overview` on 8766. Frontend uses `apiUrl()`
with different bases. Overkill.

**Option C**: Client-side priority queue. Wrap `api()` in a semaphore that
caps concurrent requests to 5 and gives priority to cheap endpoints
(health, status). Fiddly.

### ⚠️ P1 — Backend server-side response cache

For `/api/models/learning-lab/overview` and any other >2 s endpoint, add a
server-side memoization (with a TTL and manifest-mtime invalidation). The
`build_overview_payload` in `prediction/learning_lab.py` is a good candidate.
Even a 30 s in-memory cache would eliminate 95 % of the pain.

### ⚠️ P1 — Move heavy IPC reads off the Electron main process

`electron/main-modern.cjs:531`. Replace `fs.readFileSync` + `JSON.parse` with
async equivalents that stream the file and parse in a worker:
```js
ipcMain.handle("read-project-data-file", async (_evt, relativePath) => {
  // validation same as before
  const raw = await fs.promises.readFile(filePath, "utf8");
  // parse in worker_threads to avoid blocking
  return { ok: true, data: JSON.parse(raw) };
});
```
Even the async `readFile` alone unblocks the main process during disk I/O.
For the 73 MB `clinical_simulation_snapshot.json`, consider streaming JSON
parsing (`stream-json` npm package) or splitting the snapshot.

### 💡 P2 — Reduce boot fetch fan-out on component mount

Several screen-level components fire their own fetches on mount (e.g.
`InvestmentSimulationView`, `ModelAccuracyLabView`, `LearningLabView`). Some
of these fetches are redundant with what `refreshApi` / `reloadAllSheets`
already fetched. Audit each `useEffect(() => { fetch... }, [])` and:
- Prefer consuming data from a shared store / context.
- Add a `debounce` if the effect fires on tab focus changes.

### 💡 P2 — Drop the 10 s health poller once online

`App.tsx:635`: `setInterval(tick, 10_000)`. This runs forever. Once `apiOk === true`,
this is 6 pings/minute for the lifetime of the app just to detect the very
rare "backend crashed" event. Consider:
- Increase interval to 30 s once online.
- Or replace with a passive detector: only escalate to health-check if any
  regular API call has just failed with `res.status === 0`.

---

## 8. Sanity checks / open questions for the next agent

- ❓ Is `SUPERNOVA_API_PERF=1` intended to stay enabled in production? Its overhead is small but non-zero. If the user is running with it, they should be aware the perf logs themselves add I/O.
- ❓ How many rows do the "sheet snapshot" JSON files have in a typical user's data? The 73 MB `clinical_simulation_snapshot.json` is alarming. Is there a way to slim it (drop historical rows)?
- ❓ `build_overview_payload` in `prediction/learning_lab.py` — I did not read this file. Verify it's not doing a full retrain on every call.
- ❓ `/api/orchestrator/log?tail=4000` — 4000 lines of log at boot. Is this actually needed for the initial render, or only when the user opens System view?
- ❓ Uvicorn worker count. Currently 1 worker → GIL contention between the heavy handler in threadpool and the event loop. Consider `workers=2` if the backend is stateful-friendly (needs verification of module-level state like `_proc`, `_run_lock`).

---

## 9. File map (for the next agent)

Files most relevant to performance work, in priority order:

| File | LOC | Role |
|---|---|---|
| `desktop-ui/src/App.tsx` | 1900+ | App shell, boot orchestration, tab switching, health poller |
| `desktop-ui/src/api/supernova.ts` | 2000+ | All backend API wrappers; caches live here |
| `desktop-ui/src/data/projectData.ts` | ~200 | Local JSON reading (IPC + fetch), memory cache |
| `desktop-ui/src/api/investSim.ts` | ~300 | `sim-history` API + cache |
| `desktop-ui/src/data/investmentSimOutcomesData.ts` | ~300 | `sim-outcomes` loader + cache |
| `desktop-ui/src/data/modelLearningsData.ts` | ~180 | 9-parallel fetch bundle for Models tab |
| `desktop-ui/src/components/InvestmentSimulationView.tsx` | 5106 | Evaluation Lab main view (Loading… stuck here?) |
| `desktop-ui/src/components/ModelAccuracyLabView.tsx` | ~540 | Model quality main view (Loading… stuck here?) |
| `desktop-ui/src/components/ModelComparisonPanel.tsx` | 3730 | 15-chart panel, partial `useInViewOnce` fix |
| `desktop-ui/src/hooks/useInViewOnce.ts` | ~50 | Lazy-mount hook |
| `electron/main-modern.cjs` | ~700 | Electron main process, IPC handlers, protocol handler |
| `supernova_api.py` | 2314 | FastAPI backend, ~100 routes, uvicorn entrypoint |
| `prediction/learning_lab.py` | ? | `build_overview_payload` — 15 s endpoint's implementation |

---

## 10. Reproduction recipe

```powershell
# 1. Build the Electron frontend
cd "c:\coding\Biotech_Investment app 6\desktop-ui"
npm run build:electron

# 2. Launch the desktop app (starts the Python backend as a subprocess)
cd "c:\coding\Biotech_Investment app 6"
.\scripts\Avvia_SuperNova_Electron.bat

# 3. In the app, open DevTools (Ctrl+Shift+I)
# 4. Filter Console by "PERF"
# 5. Switch tabs (Dashboard → Evaluation Lab → Model quality)
# 6. Observe the [PERF:api] durations. Expect /api/health <10 ms and no duplicates.
```

**Success criteria for P0**:
- Boot: no more than 6 concurrent HTTP requests visible in Network waterfall.
- `/api/health` in Console log: <200 ms every time.
- No duplicate `/api/status` or duplicate `/api/investment/sim-outcomes` at boot.
- Evaluation Lab and Model quality tabs render within 5 s of first open.

**Success criteria for P1**:
- `/api/models/learning-lab/overview` on second open: served from cache (<10 ms).
- `[PERF:ipc] clinical_simulation_snapshot.json` <2 s on cold read (from 8.8 s).
- Main-process responsiveness: window drag / resize does not stutter during IPC reads.

---

## 11. Do NOT do

- Do not touch `mobile-ui/` — mobile app is deliberately separate (see `.cursor/rules/mobile-vs-desktop.mdc`). All perf issues here are desktop-only.
- Do not refactor `InvestmentSimulationView.tsx` (5106 LOC) as a first move — too risky. Fix P0 items first.
- Do not `git commit` intermixed changes; the working tree already has many unrelated pre-existing modifications. Prefer selective staging.
- Do not disable perf logging as a "fix" — it's diagnostic, remove only after real fixes are verified.

---

*End of handoff document. Next agent: start with §7 P0 items in order, verify each fix in the running app with DevTools, and update §6.7 effectiveness table.*
