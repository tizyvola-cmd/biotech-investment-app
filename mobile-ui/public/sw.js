/* SuperNova Mobile — Web Push + notification click */
/* global self, clients */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function openPathFromPayload(data) {
  const base = self.registration.scope || "/";
  const root = base.endsWith("/") ? base : `${base}/`;
  if (data && typeof data.url === "string" && data.url) {
    try {
      return new URL(data.url, root).href;
    } catch {
      /* fall through */
    }
  }
  return root;
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    try {
      payload = { body: event.data ? event.data.text() : "" };
    } catch {
      payload = {};
    }
  }
  const title =
    (payload && payload.title) || "SuperNova — actions";
  const body = (payload && payload.body) || "";
  const tag = (payload && payload.tag) || "supernova-soft-rec";
  const options = {
    body,
    tag,
    renotify: true,
    data: payload || {},
    requireInteraction: Boolean(
      payload && Array.isArray(payload.sellTickers) && payload.sellTickers.length > 0,
    ),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = openPathFromPayload(data);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client && targetUrl) {
            try {
              return client.navigate(targetUrl).then((c) => (c && c.focus ? c.focus() : client.focus()));
            } catch {
              return client.focus();
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
