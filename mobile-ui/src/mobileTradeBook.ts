import type { InvestSimInputEntry, InvestSimInputs, SheetTable } from "./types";
import {
  buildSimRowByKeyMap,
  computeSimulationPosition,
  currentPriceFromRow,
  normalizedRowKey,
  type SimulationPosition,
} from "./simLogic";

export function openBookCapital(inputs: InvestSimInputs | null | undefined): number {
  let s = 0;
  for (const e of Object.values(inputs ?? {})) {
    if (e && !e.ignoreSheet && (e.capital ?? 0) > 0) s += e.capital ?? 0;
  }
  return s;
}

/** Soft BUY just saved on mobile before Pulse republishes openPositions. */
export const RECENT_MOBILE_BUY_MS = 15 * 60 * 1000;

export function openKeysFromPositions(
  positions: { key?: string | null }[] | null | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const p of positions ?? []) {
    const k = String(p?.key ?? "").trim();
    if (k) out.add(k);
  }
  return out;
}

/**
 * When desktop Pulse publishes openPositions, treat that set as authority:
 * close stale VPS ghost opens, but keep a just-saved mobile buy (&lt;15 min).
 */
export function alignOpenBookToDesktopPulse(
  inputs: InvestSimInputs,
  desktopOpenKeys: Set<string> | string[],
  opts?: { allowRecentBuyMs?: number; nowMs?: number },
): InvestSimInputs {
  const keys =
    desktopOpenKeys instanceof Set
      ? desktopOpenKeys
      : new Set(desktopOpenKeys.filter(Boolean));
  if (keys.size === 0) return inputs;
  const allowMs = opts?.allowRecentBuyMs ?? RECENT_MOBILE_BUY_MS;
  const now = opts?.nowMs ?? Date.now();
  let changed = false;
  const out: InvestSimInputs = { ...inputs };
  for (const [k, e] of Object.entries(inputs)) {
    if (!e || e.ignoreSheet || !(e.capital > 0)) continue;
    if (keys.has(k)) continue;
    const inv = e.investedAt ? Date.parse(e.investedAt) : NaN;
    if (Number.isFinite(inv) && now - inv >= 0 && now - inv < allowMs) continue;
    out[k] = {
      ...e,
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      soldAt: e.soldAt ?? new Date(now).toISOString(),
      closedCapital: e.closedCapital ?? e.capital,
    };
    changed = true;
  }
  return changed ? out : inputs;
}

/**
 * Re-open Pulse names wiped by a stale empty VPS sim-inputs file.
 * Authority = desktop snapshot investSimInputs (or any open book that still has them).
 */
export function restoreOpensFromPulseAuthority(
  inputs: InvestSimInputs,
  authority: InvestSimInputs | null | undefined,
  desktopOpenKeys: Set<string> | string[],
): InvestSimInputs {
  const keys =
    desktopOpenKeys instanceof Set
      ? desktopOpenKeys
      : new Set(desktopOpenKeys.filter(Boolean));
  if (keys.size === 0 || !authority) return inputs;
  let changed = false;
  const out: InvestSimInputs = { ...inputs };
  for (const k of keys) {
    const auth = authority[k];
    if (!auth || auth.ignoreSheet || !(auth.capital > 0) || !(auth.buyPrice > 0)) {
      continue;
    }
    const cur = out[k];
    if (cur && !cur.ignoreSheet && (cur.capital ?? 0) > 0 && (cur.buyPrice ?? 0) > 0) {
      continue;
    }
    const soldMs = cur?.soldAt ? Date.parse(cur.soldAt) : NaN;
    const authInv = auth.investedAt ? Date.parse(auth.investedAt) : NaN;
    // VPS merge keeps sold unless investedAt > soldAt — bump stamp when reopening.
    let investedAt = auth.investedAt;
    if (Number.isFinite(soldMs) && (!Number.isFinite(authInv) || authInv <= soldMs)) {
      investedAt = new Date(soldMs + 1000).toISOString();
    }
    out[k] = { ...auth, ignoreSheet: false, investedAt };
    delete out[k].soldAt;
    changed = true;
  }
  return changed ? out : inputs;
}

/** Keep opens that exist only on one side (mobile buy vs desktop Pulse). */
export function unionOpenBooks(
  primary: InvestSimInputs,
  secondary: InvestSimInputs | null | undefined,
  opts?: { nowMs?: number },
): InvestSimInputs {
  const out: InvestSimInputs = { ...primary };
  for (const [k, e] of Object.entries(secondary ?? {})) {
    if (!e || e.ignoreSheet || !(e.capital > 0) || !(e.buyPrice > 0)) continue;
    const cur = out[k];
    if (!cur || cur.ignoreSheet || !(cur.capital > 0)) {
      // Desktop/remote sold this key — do not resurrect from a stale secondary open
      // unless secondary rebuy stamp is strictly after soldAt.
      if (cur?.ignoreSheet && cur.soldAt) {
        const sold = Date.parse(cur.soldAt);
        const inv = e.investedAt ? Date.parse(e.investedAt) : NaN;
        if (Number.isFinite(sold) && (!Number.isFinite(inv) || inv <= sold)) {
          continue;
        }
      }
      out[k] = { ...e, ignoreSheet: false };
      if (out[k].soldAt) delete out[k].soldAt;
    }
  }
  // Mobile Soft SELL race only — do not apply stale VPS "all closed" files over a live Pulse book.
  const now = opts?.nowMs ?? Date.now();
  for (const [k, e] of Object.entries(secondary ?? {})) {
    if (!e?.ignoreSheet || !e.soldAt) continue;
    const cur = out[k];
    if (!cur || cur.ignoreSheet) continue;
    const sold = Date.parse(e.soldAt);
    if (!Number.isFinite(sold) || sold > now || now - sold >= RECENT_MOBILE_BUY_MS) {
      continue;
    }
    const inv = cur.investedAt ? Date.parse(cur.investedAt) : 0;
    if (!Number.isFinite(inv) || sold >= inv) {
      out[k] = { ...e };
    }
  }
  return out;
}

export type MobileTradeTarget = {
  /** Soft chip key (may differ from sheet canon). */
  requestKey: string;
  /** Canonical Simulation key — always write the book under this. */
  canonKey: string;
  ticker: string;
  row: Record<string, unknown> | null;
  pos: SimulationPosition | null;
  priceUsd: number | null;
};

/**
 * Resolve Soft BUY/SELL chip → sheet row + canonical invest key.
 * Soft lists sometimes use a CD formatting that doesn't match rowMap exactly.
 */
export function resolveMobileTradeTarget(
  key: string,
  sheet: SheetTable | null | undefined,
  inputs: InvestSimInputs,
): MobileTradeTarget {
  const requestKey = String(key ?? "").trim();
  const tickerGuess =
    requestKey.split("|")[0]?.trim().toUpperCase() || requestKey.toUpperCase();
  const rowMap = buildSimRowByKeyMap(sheet?.rows ?? []);

  let row = rowMap.get(requestKey) ?? null;
  let canonKey = requestKey;

  if (!row && tickerGuess) {
    const cdPart = requestKey.includes("|")
      ? requestKey.slice(requestKey.indexOf("|") + 1)
      : "";
    // Prefer same ticker + matching normalized CD, else any open/first ticker row.
    let fallback: { k: string; r: Record<string, unknown> } | null = null;
    for (const [k, r] of rowMap) {
      const tk = String(r.Ticker ?? "")
        .trim()
        .toUpperCase();
      if (tk !== tickerGuess) continue;
      const canon = normalizedRowKey(tk, r["Completion Date"]);
      if (cdPart && canon === normalizedRowKey(tickerGuess, cdPart)) {
        row = r;
        canonKey = canon;
        break;
      }
      if (!fallback) fallback = { k: canon, r };
    }
    if (!row && fallback) {
      row = fallback.r;
      canonKey = fallback.k;
    }
  }

  if (row) {
    canonKey = normalizedRowKey(
      String(row.Ticker ?? "").trim().toUpperCase(),
      row["Completion Date"],
    );
  }

  const pos =
    (row ? computeSimulationPosition(row, inputs) : null) ??
    (inputs[canonKey] && !inputs[canonKey]!.ignoreSheet
      ? ({
          key: canonKey,
          ticker: tickerGuess,
          name: tickerGuess,
          completionDate: canonKey.split("|")[1] ?? "—",
          currPrice: null,
          buyPrice: inputs[canonKey]!.buyPrice,
          capital: inputs[canonKey]!.capital,
          shares: 0,
          valueNow: 0,
          pnlEur: 0,
          pnlPct: 0,
          pnlUnavailable: true,
        } satisfies SimulationPosition)
      : null);

  const priceUsd =
    (pos?.currPrice != null && pos.currPrice > 0
      ? pos.currPrice
      : row
        ? currentPriceFromRow(row)
        : null) ?? null;

  const ticker =
    pos?.ticker ||
    (row ? String(row.Ticker ?? "").trim().toUpperCase() : "") ||
    tickerGuess;

  return { requestKey, canonKey, ticker, row, pos, priceUsd };
}

/** Soft BUY/SELL entry writer — rebuy after sell always gets a fresh investedAt. */
export function mergeEntryForSave(
  prev: InvestSimInputEntry | undefined,
  buyPrice: number,
  capital: number,
  close: boolean,
  closeSnap?: { capital: number; valueNow: number; pnlEur: number } | null,
): InvestSimInputEntry {
  if (close) {
    return {
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      ...(prev?.investedAt ? { investedAt: prev.investedAt } : {}),
      ...(prev?.purchaseDate ? { purchaseDate: prev.purchaseDate } : {}),
      soldAt: new Date().toISOString(),
      ...(closeSnap && closeSnap.capital > 0
        ? {
            closedCapital: closeSnap.capital,
            closedValue: Math.round(closeSnap.valueNow * 100) / 100,
            closedPnlEur: Math.round(closeSnap.pnlEur * 100) / 100,
          }
        : {}),
    };
  }
  const next: InvestSimInputEntry = {
    buyPrice: Math.max(0, buyPrice),
    capital: Math.max(0, capital),
    ignoreSheet: false,
  };
  // Rebuy after Soft/manual SELL must get a fresh investedAt — otherwise Pulse
  // alignment + server merge treat the open as a stale ghost / lose to soldAt.
  const reopening = Boolean(prev?.ignoreSheet || prev?.soldAt);
  if (capital > 0 && buyPrice > 0) {
    if (!prev?.investedAt || reopening) {
      next.investedAt = new Date().toISOString();
    } else {
      next.investedAt = prev.investedAt;
      if (prev.purchaseDate) next.purchaseDate = prev.purchaseDate;
    }
  }
  return next;
}

/** Prefer keeping a just-saved local book when a concurrent reload is older. */
export function preferLocalBookIfFresher(
  local: InvestSimInputs,
  localUpdatedAt: string | null | undefined,
  remote: InvestSimInputs,
  remoteUpdatedAt: string | null | undefined,
): InvestSimInputs {
  const localCap = openBookCapital(local);
  const localMs = localUpdatedAt ? Date.parse(localUpdatedAt) : 0;
  const remoteMs = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : 0;
  // Timestamp only — never keep a fatter ghost book over a thinner Pulse book.
  if (localCap > 0 && localMs > 0 && (remoteMs <= 0 || localMs >= remoteMs)) {
    return unionOpenBooks(local, remote);
  }
  return unionOpenBooks(remote, local);
}

export function patchSnapshotInvestSimInputs(
  prev: InvestSimInputs | null | undefined,
  next: InvestSimInputs,
): InvestSimInputs {
  return unionOpenBooks(next, prev);
}

export type { InvestSimInputEntry };
