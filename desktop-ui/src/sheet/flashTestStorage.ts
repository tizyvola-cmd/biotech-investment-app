import {
  FLASH_TEST_DEFAULT_BANKROLL,
  FLASH_TEST_DEFAULT_CAPITAL,
  FLASH_TEST_EQUITY_MAX,
  FLASH_TEST_GENS,
  FLASH_TEST_RUN_DAYS,
  FLASH_TEST_SIGNALS_MAX,
  FLASH_TEST_TRADES_MAX,
  type FlashTestArmState,
  type FlashTestMissCounts,
  type FlashTestSignalRow,
  type FlashTestState,
  type SoftLogicGenId,
} from "./flashTestTypes";

export const FLASH_TEST_STORAGE_KEY = "flash_test_soft_logic_v1";
export const FLASH_TEST_CHANGED_EVENT = "flash-test-changed";

function emptyArm(gen: SoftLogicGenId): FlashTestArmState {
  return {
    gen,
    portfolio: [],
    trades: [],
    equity: [],
    cumulativeClosedPnlEur: 0,
    closedTradeCount: 0,
    peakPnlByKey: {},
    lastTickSignals: [],
    lastTickMissCounts: {},
  };
}

function normalizeMissCounts(raw: unknown): FlashTestMissCounts {
  if (!raw || typeof raw !== "object") return {};
  const out: FlashTestMissCounts = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (k && Number.isFinite(n) && n > 0) out[k] = Math.round(n);
  }
  return out;
}

function normalizeSignals(raw: unknown): FlashTestSignalRow[] {
  if (!Array.isArray(raw)) return [];
  const out: FlashTestSignalRow[] = [];
  for (const row of raw.slice(0, FLASH_TEST_SIGNALS_MAX)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<FlashTestSignalRow>;
    if (!r.key || !r.ticker || (r.side !== "buy" && r.side !== "sell")) continue;
    out.push({
      key: String(r.key),
      ticker: String(r.ticker),
      side: r.side,
      priority: Number(r.priority) || 0,
      reason: String(r.reason ?? ""),
    });
  }
  return out;
}

export function defaultFlashTestState(): FlashTestState {
  const arms = {} as Record<SoftLogicGenId, FlashTestArmState>;
  for (const g of FLASH_TEST_GENS) arms[g] = emptyArm(g);
  return {
    version: 1,
    enabled: false,
    startedAt: null,
    endsAt: null,
    capitalPerTrade: FLASH_TEST_DEFAULT_CAPITAL,
    bankrollEur: FLASH_TEST_DEFAULT_BANKROLL,
    maxOpenPositions: Number.POSITIVE_INFINITY,
    arms,
    lastTickAt: null,
  };
}

function normalizeArm(raw: Partial<FlashTestArmState> | undefined, gen: SoftLogicGenId): FlashTestArmState {
  const base = emptyArm(gen);
  if (!raw) return base;
  return {
    gen,
    portfolio: Array.isArray(raw.portfolio) ? raw.portfolio : [],
    trades: Array.isArray(raw.trades) ? raw.trades.slice(-FLASH_TEST_TRADES_MAX) : [],
    equity: Array.isArray(raw.equity) ? raw.equity.slice(-FLASH_TEST_EQUITY_MAX) : [],
    cumulativeClosedPnlEur: Number(raw.cumulativeClosedPnlEur) || 0,
    closedTradeCount: Number(raw.closedTradeCount) || 0,
    peakPnlByKey:
      raw.peakPnlByKey && typeof raw.peakPnlByKey === "object"
        ? { ...raw.peakPnlByKey }
        : {},
    lastTickSignals: normalizeSignals(raw.lastTickSignals),
    lastTickMissCounts: normalizeMissCounts(raw.lastTickMissCounts),
  };
}

export function loadFlashTestState(): FlashTestState {
  try {
    const raw = localStorage.getItem(FLASH_TEST_STORAGE_KEY);
    if (!raw) return defaultFlashTestState();
    const parsed = JSON.parse(raw) as Partial<FlashTestState>;
    const base = defaultFlashTestState();
    const arms = {} as Record<SoftLogicGenId, FlashTestArmState>;
    for (const g of FLASH_TEST_GENS) {
      arms[g] = normalizeArm(parsed.arms?.[g], g);
    }
    return {
      ...base,
      ...parsed,
      version: 1,
      arms,
      capitalPerTrade:
        Number(parsed.capitalPerTrade) > 0
          ? Number(parsed.capitalPerTrade)
          : FLASH_TEST_DEFAULT_CAPITAL,
      bankrollEur:
        Number(parsed.bankrollEur) > 0
          ? Number(parsed.bankrollEur)
          : FLASH_TEST_DEFAULT_BANKROLL,
      maxOpenPositions:
        parsed.maxOpenPositions != null && Number.isFinite(Number(parsed.maxOpenPositions))
          ? Number(parsed.maxOpenPositions)
          : Number.POSITIVE_INFINITY,
    };
  } catch {
    return defaultFlashTestState();
  }
}

export function saveFlashTestState(state: FlashTestState): FlashTestState {
  const next: FlashTestState = {
    ...state,
    version: 1,
    arms: { ...state.arms },
  };
  for (const g of FLASH_TEST_GENS) {
    const arm = next.arms[g] ?? emptyArm(g);
    next.arms[g] = {
      ...arm,
      trades: arm.trades.slice(-FLASH_TEST_TRADES_MAX),
      equity: arm.equity.slice(-FLASH_TEST_EQUITY_MAX),
      lastTickSignals: (arm.lastTickSignals ?? []).slice(0, FLASH_TEST_SIGNALS_MAX),
    };
  }
  const write = (s: FlashTestState) =>
    localStorage.setItem(FLASH_TEST_STORAGE_KEY, JSON.stringify(s));
  let saved = false;
  try {
    write(next);
    saved = true;
  } catch {
    // Quota: prune harder and retry once — avoid dispatching a stale reload.
    try {
      for (const g of FLASH_TEST_GENS) {
        const arm = next.arms[g]!;
        next.arms[g] = {
          ...arm,
          trades: arm.trades.slice(-Math.floor(FLASH_TEST_TRADES_MAX / 4)),
          equity: arm.equity.slice(-Math.floor(FLASH_TEST_EQUITY_MAX / 4)),
        };
      }
      write(next);
      saved = true;
    } catch {
      /* keep in-memory next; do not sync-from-storage */
    }
  }
  if (saved) {
    window.dispatchEvent(new CustomEvent(FLASH_TEST_CHANGED_EVENT));
  }
  return next;
}

export function startFlashTestRun(
  state: FlashTestState,
  opts?: { days?: number; capitalPerTrade?: number; bankrollEur?: number },
): FlashTestState {
  const days = opts?.days ?? FLASH_TEST_RUN_DAYS;
  const startedAt = new Date().toISOString();
  const ends = new Date();
  ends.setDate(ends.getDate() + days);
  const arms = {} as Record<SoftLogicGenId, FlashTestArmState>;
  for (const g of FLASH_TEST_GENS) arms[g] = emptyArm(g);
  const capital = opts?.capitalPerTrade ?? state.capitalPerTrade;
  const bankroll = opts?.bankrollEur ?? state.bankrollEur;
  const maxOpen =
    capital > 0 && Number.isFinite(bankroll)
      ? Math.max(1, Math.floor(bankroll / capital))
      : state.maxOpenPositions;
  return saveFlashTestState({
    ...state,
    enabled: true,
    startedAt,
    endsAt: ends.toISOString(),
    capitalPerTrade: capital,
    bankrollEur: bankroll,
    maxOpenPositions: maxOpen,
    arms,
    lastTickAt: null,
  });
}

export function stopFlashTestRun(state: FlashTestState): FlashTestState {
  return saveFlashTestState({ ...state, enabled: false });
}

export function resetFlashTestRun(state: FlashTestState): FlashTestState {
  return saveFlashTestState({
    ...defaultFlashTestState(),
    capitalPerTrade: state.capitalPerTrade,
    bankrollEur: state.bankrollEur,
  });
}

export function isFlashTestRunExpired(state: FlashTestState): boolean {
  if (!state.enabled || !state.endsAt) return false;
  return Date.now() >= new Date(state.endsAt).getTime();
}
