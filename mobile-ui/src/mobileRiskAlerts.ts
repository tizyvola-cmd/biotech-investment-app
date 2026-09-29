/**
 * Real-time risk alerts on mobile: auto-sold + red giveback bells.
 * In-app modal + OS notification (when permission granted).
 */

import { ensureRecNotifyPermission } from "./mobileRecSignalBanner";
import {
  pulseTickerGivebackBell,
  type PulseGivebackBell,
} from "./pulseLossOfWinsBell";

const RED_BELL_ACK_KEY = "sn_mobile_red_bell_ack_v1";
const AUTO_SOLD_PUSH_ACK_KEY = "sn_mobile_auto_sold_push_ack_v1";

export type RedBellAlertItem = {
  key: string;
  ticker: string;
  pnlEur: number | null;
  givebackPct: number | null;
  purchasedPlusGainsEur: number | null;
};

export function redBellAlertSig(items: RedBellAlertItem[]): string {
  return items
    .map((i) => i.key.toUpperCase())
    .sort()
    .join("|");
}

export function loadRedBellAck(): string | null {
  try {
    return localStorage.getItem(RED_BELL_ACK_KEY);
  } catch {
    return null;
  }
}

export function saveRedBellAck(items: RedBellAlertItem[]): void {
  try {
    localStorage.setItem(RED_BELL_ACK_KEY, redBellAlertSig(items));
  } catch {
    /* ignore */
  }
}

export function redBellNeedsAlert(items: RedBellAlertItem[]): boolean {
  if (!items.length) return false;
  return loadRedBellAck() !== redBellAlertSig(items);
}

export function buildRedBellAlertItems(
  rows: Array<{
    key: string;
    ticker: string;
    pnlEur: number | null | undefined;
    peakPnlEur?: number | null;
    capitalEur?: number | null;
    investedAt?: string | null;
  }>,
): RedBellAlertItem[] {
  const out: RedBellAlertItem[] = [];
  for (const row of rows) {
    const bell: PulseGivebackBell = pulseTickerGivebackBell(
      row.pnlEur,
      row.peakPnlEur,
      undefined,
      undefined,
      { investedAt: row.investedAt, capitalEur: row.capitalEur },
    );
    if (!bell.hit) continue;
    out.push({
      key: row.key,
      ticker: String(row.ticker || row.key.split("|")[0] || "").toUpperCase(),
      pnlEur: row.pnlEur != null && Number.isFinite(row.pnlEur) ? row.pnlEur : null,
      givebackPct: bell.givebackPctOfPeak,
      purchasedPlusGainsEur: bell.purchasedPlusGainsEur ?? bell.peakEff,
    });
  }
  return out.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

async function showOsNotification(opts: {
  title: string;
  body: string;
  tag: string;
}): Promise<void> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  const perm = await ensureRecNotifyPermission();
  if (perm !== "granted") return;
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.showNotification) {
        await reg.showNotification(opts.title, {
          body: opts.body,
          tag: opts.tag,
          // Valid for ServiceWorkerRegistration.showNotification; missing in DOM lib typings.
          renotify: true,
        } as NotificationOptions);
        return;
      }
    }
    const n = new Notification(opts.title, { body: opts.body, tag: opts.tag });
    window.setTimeout(() => n.close(), 14_000);
  } catch {
    /* ignore */
  }
}

export async function pushRedBellNotification(
  items: RedBellAlertItem[],
  it: boolean,
): Promise<void> {
  if (!redBellNeedsAlert(items)) return;
  const tickers = items.map((i) => i.ticker).slice(0, 5).join(", ");
  await showOsNotification({
    title: it
      ? `Campanella rossa · ${items.length}`
      : `Red bell · ${items.length}`,
    body: it
      ? `Perdita ≥20% di (acquistato + guadagnato)${tickers ? `: ${tickers}` : ""}.`
      : `Loss ≥20% of (purchased + gains)${tickers ? `: ${tickers}` : ""}.`,
    tag: "supernova-red-bell",
  });
}

export async function pushAutoSoldOsNotification(
  event: { id?: string; items?: Array<{ ticker?: string }> } | null | undefined,
  it: boolean,
): Promise<void> {
  if (!event?.id || !Array.isArray(event.items) || !event.items.length) return;
  try {
    if (localStorage.getItem(AUTO_SOLD_PUSH_ACK_KEY) === event.id) return;
    localStorage.setItem(AUTO_SOLD_PUSH_ACK_KEY, event.id);
  } catch {
    /* still try to notify */
  }
  const tickers = event.items
    .map((i) => String(i.ticker || "").toUpperCase())
    .filter(Boolean)
    .slice(0, 5)
    .join(", ");
  await showOsNotification({
    title: it
      ? `Vendita automatica · ${event.items.length}`
      : `Auto-sold · ${event.items.length}`,
    body: it
      ? `Chiusi dal desktop${tickers ? `: ${tickers}` : ""}.`
      : `Closed by desktop${tickers ? `: ${tickers}` : ""}.`,
    tag: "supernova-auto-sold",
  });
}
