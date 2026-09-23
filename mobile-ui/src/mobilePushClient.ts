/**
 * Web Push subscribe/unsubscribe for Soft BUY/SELL action alerts (app closed).
 */
import { api } from "./api";

const PREF_KEY = "sn_mobile_push_pref_v1";

export type ActionPushStatus = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  prefEnabled: boolean;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushPrefEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function setPushPref(on: boolean): void {
  try {
    if (on) localStorage.setItem(PREF_KEY, "1");
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* ignore */
  }
}

export function pushApiSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

export async function registerMobileServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  const swUrl = `${base}sw.js`;
  try {
    return await navigator.serviceWorker.register(swUrl, { scope: base });
  } catch {
    return null;
  }
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await registerMobileServiceWorker();
  } catch {
    return null;
  }
}

export function getActionPushStatus(): ActionPushStatus {
  if (!pushApiSupported()) {
    return {
      supported: false,
      permission: "unsupported",
      subscribed: false,
      prefEnabled: isPushPrefEnabled(),
    };
  }
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: false,
    prefEnabled: isPushPrefEnabled(),
  };
}

export async function refreshActionPushStatus(): Promise<ActionPushStatus> {
  const base = getActionPushStatus();
  if (!base.supported) return base;
  const reg = await readyRegistration();
  let subscribed = false;
  try {
    const sub = await reg?.pushManager.getSubscription();
    subscribed = Boolean(sub);
  } catch {
    subscribed = false;
  }
  return { ...base, subscribed };
}

export async function enableActionPush(): Promise<ActionPushStatus> {
  if (!pushApiSupported()) {
    throw new Error("unsupported");
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    setPushPref(false);
    return refreshActionPushStatus();
  }
  const reg = await readyRegistration();
  if (!reg) throw new Error("service worker unavailable");

  const { publicKey } = await api<{ publicKey: string }>("/api/mobile/push/vapid-public-key");
  if (!publicKey || typeof publicKey !== "string") {
    throw new Error("VAPID public key missing on server");
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }
  const json = sub.toJSON();
  await api("/api/mobile/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      expirationTime: json.expirationTime ?? null,
    }),
  });
  setPushPref(true);
  return refreshActionPushStatus();
}

export async function disableActionPush(): Promise<ActionPushStatus> {
  const reg = await readyRegistration();
  try {
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      try {
        await api("/api/mobile/push/unsubscribe", {
          method: "POST",
          body: JSON.stringify({ endpoint }),
        });
      } catch {
        /* still drop local sub */
      }
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
  setPushPref(false);
  return refreshActionPushStatus();
}
