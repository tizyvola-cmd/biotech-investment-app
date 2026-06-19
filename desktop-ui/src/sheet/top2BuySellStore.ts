/**
 * top2BuySellStore — Top 2 BUY / Top 2 SELL pubblicati da Decision Lab
 * per la Dashboard (sotto Piggy Bank).
 */

const STORAGE_KEY = "supernova_top2_buy_sell";
const EVENT_NAME = "supernova:top2-buy-sell-changed";

export type Top2PrioritySignal = {
  ticker: string;
  cd: string;
  days: number | null;
  pred5: number | null;
  affid: number | null;
  r2: number | null;
  slope20d: number | null;
  precatExpectedReturn: number | null;
  /** Score composito 0–100 (Decision Lab). */
  score?: number;
  /** ROI piano verso CD (allineato OpportunityCard). */
  planReturnPct?: number | null;
  planDays?: number | null;
  planCapitalEur?: number;
  planGainSource?: string | null;
  clinicalPhase?: string;
  clinicalIndication?: string;
  action?: string;
  precatKind?: string;
  precatLabel?: string;
  precatProbPositive?: number | null;
  expectedHitPct?: number | null;
  effectiveHitPct?: number | null;
  stabilityVerdict?: string;
  timing?: string;
  hasPosition: boolean;
  pnlPct: number | null;
  pnlEur: number | null;
  pnlEur24h: number | null;
  pnlPct24h: number | null;
  buyPriceUsd: number | null;
  currentPriceUsd: number | null;
  clinicalKpi: number | null;
  k8Kpi: number | null;
  simRow: Record<string, unknown>;
};

export type Top2BuySellSnapshot = {
  buy: Top2PrioritySignal[];
  sell: Top2PrioritySignal[];
  updatedAt: number;
};

function emptySnapshot(): Top2BuySellSnapshot {
  return { buy: [], sell: [], updatedAt: 0 };
}

function readFromStorage(): Top2BuySellSnapshot {
  if (typeof window === "undefined") return emptySnapshot();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySnapshot();
    const parsed = JSON.parse(raw) as Partial<Top2BuySellSnapshot>;
    const buy = Array.isArray(parsed.buy) ? parsed.buy : [];
    const sell = Array.isArray(parsed.sell) ? parsed.sell : [];
    return {
      buy,
      sell,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return emptySnapshot();
  }
}

let _current: Top2BuySellSnapshot = readFromStorage();

export function getTop2BuySell(): Top2BuySellSnapshot {
  return _current;
}

export function setTop2BuySell(buy: Top2PrioritySignal[], sell: Top2PrioritySignal[]): void {
  if (typeof window === "undefined") return;
  const snap: Top2BuySellSnapshot = {
    buy: buy.slice(0, 2),
    sell: sell.slice(0, 2),
    updatedAt: Date.now(),
  };
  _current = snap;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* quota */
  }
  try {
    window.dispatchEvent(new CustomEvent<Top2BuySellSnapshot>(EVENT_NAME, { detail: snap }));
  } catch {
    /* no window */
  }
}

export function subscribeTop2BuySell(
  cb: (snap: Top2BuySellSnapshot) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = (ev: Event) => {
    const detail = (ev as CustomEvent<Top2BuySellSnapshot>).detail;
    cb(detail?.buy ? detail : _current);
  };
  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== STORAGE_KEY) return;
    _current = readFromStorage();
    cb(_current);
  };
  window.addEventListener(EVENT_NAME, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
