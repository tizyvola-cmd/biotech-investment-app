/**
 * In-app + OS banner for Soft/Urgent SELL only (Soft BUY alerts removed).
 */
const ACK_KEY = "sn_mobile_rec_signal_ack_v1";
const PERM_ASKED_KEY = "sn_mobile_rec_notify_asked_v1";

export type RecSignalSnapshot = {
  buyKeys: string[];
  sellKeys: string[];
};

function sigOf(s: RecSignalSnapshot): string {
  const sell = [...s.sellKeys].map((k) => k.toUpperCase()).sort().join(",");
  return `s:${sell}`;
}

export function loadRecSignalAck(): string | null {
  try {
    return localStorage.getItem(ACK_KEY);
  } catch {
    return null;
  }
}

export function saveRecSignalAck(snapshot: RecSignalSnapshot): void {
  try {
    localStorage.setItem(ACK_KEY, sigOf(snapshot));
  } catch {
    /* ignore */
  }
}

export function recSignalNeedsBanner(snapshot: RecSignalSnapshot): boolean {
  if (snapshot.sellKeys.length === 0) return false;
  const ack = loadRecSignalAck();
  return ack !== sigOf(snapshot);
}

export function formatRecSignalBanner(
  snapshot: RecSignalSnapshot,
  it: boolean,
): { title: string; body: string } {
  const nSell = snapshot.sellKeys.length;
  const sellTickers = snapshot.sellKeys
    .map((k) => k.split("|")[0] ?? k)
    .slice(0, 4)
    .join(", ");

  return {
    title: it ? `Vendi subito · ${nSell}` : `Sell now · ${nSell}`,
    body: it
      ? `Soft/Urgent SELL${sellTickers ? `: ${sellTickers}` : ""} sul tuo book.`
      : `Soft/Urgent SELL${sellTickers ? `: ${sellTickers}` : ""} on your book.`,
  };
}

export async function ensureRecNotifyPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    if (localStorage.getItem(PERM_ASKED_KEY) === "1") {
      return Notification.permission;
    }
    localStorage.setItem(PERM_ASKED_KEY, "1");
  } catch {
    /* ignore */
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function pushRecSignalNotification(
  snapshot: RecSignalSnapshot,
  it: boolean,
): Promise<void> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (!recSignalNeedsBanner(snapshot)) return;
  const perm = await ensureRecNotifyPermission();
  if (perm !== "granted") return;
  const { title, body } = formatRecSignalBanner(snapshot, it);
  const sellTickers = snapshot.sellKeys.map((k) => k.split("|")[0] ?? k).slice(0, 6);
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.showNotification) {
        await reg.showNotification(title, {
          body,
          tag: "supernova-soft-sell",
          data: { sellTickers },
        });
        return;
      }
    }
    const n = new Notification(title, {
      body,
      tag: "supernova-soft-sell",
    });
    window.setTimeout(() => n.close(), 12_000);
  } catch {
    /* some browsers require service worker for Notification */
  }
}
