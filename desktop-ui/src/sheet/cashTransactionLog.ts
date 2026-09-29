import type { ExperimentId } from "./experimentCash";

export type CashTransaction = {
  at: string;
  experiment: ExperimentId;
  rowKey: string;
  oldCapital: number;
  newCapital: number;
  cashBefore: number;
  cashAfter: number;
};

const LOG_KEY = "supernova_cash_tx_log";
const MAX_ENTRIES = 200;

function loadLog(): CashTransaction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as CashTransaction[]) : [];
  } catch {
    return [];
  }
}

function saveLog(entries: CashTransaction[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

export function appendCashTransaction(tx: Omit<CashTransaction, "at">): void {
  const entries = loadLog();
  entries.push({ ...tx, at: new Date().toISOString() });
  saveLog(entries);
}

export function loadCashTransactionLog(): CashTransaction[] {
  return loadLog();
}

export function clearCashTransactionLog(): void {
  saveLog([]);
}
