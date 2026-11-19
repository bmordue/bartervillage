/**
 * Service worker for web push (spec §11; M7.12).
 *
 * Listens for push notifications from the tick resolver and shows them to the
 * player. Clicking a notification opens the latest tick replay.
 */

self.addEventListener("push", (event) => {
  let title = "Barter Village";
  let body = "A new tick has resolved.";
  let data = { type: "tick_resolved" };
  try {
    const payload = event.data?.json() ?? {};
    title = payload.title ?? title;
    body = payload.body ?? body;
    data = payload.data ?? data;
  } catch {
    // Keep defaults if the payload is unreadable.
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: `tick-${data.tick ?? "latest"}`,
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const promiseChain = event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
      const data = event.notification.data || {};
      const tick = typeof data.tick !== "undefined" ? data.tick : null;
      const tickParam = tick !== null ? `?tick=${tick}` : "";
      const replayUrl = `/replay/latest${tickParam}`;
      for (const client of clients) {
        if (client.url.includes("/replay/latest")) {
          return client.focus().then(() => client.navigate(replayUrl));
        }
      }
      return self.clients.openWindow(replayUrl);
    }),
  );
  event.waitUntil(promiseChain);
});
