/**
 * Push subscription client (spec §11; M7.12).
 *
 * Registers the service worker, requests notification permission, subscribes
 * the player to web push using VAPID keys, and sends the subscription to the
 * server so the worker can deliver tick-resolved notifications.
 */

let serviceWorkerRegistered = false;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (serviceWorkerRegistered) {
    return navigator.serviceWorker.ready;
  }
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service worker not supported in this browser");
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  serviceWorkerRegistered = true;
  return registration;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission();
}

export async function getVapidPublicKey(): Promise<string | undefined> {
  const response = await fetch("/vapid-key", { credentials: "include" });
  if (!response.ok) {
    return undefined;
  }
  const body = await response.json();
  return body?.publicKey;
}

export async function subscribeToPush(
  playerId: string,
  subscription: {
    endpoint: string;
    keys: { auth: string; p256dh: string };
  },
): Promise<void> {
  await fetch("/push/subscriptions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-player-id": playerId,
    },
    body: JSON.stringify({
      playerId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    }),
    credentials: "include",
  });
}

export async function unsubscribeFromPush(playerId: string, endpoint: string): Promise<void> {
  await fetch("/push/subscriptions", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "x-player-id": playerId,
    },
    body: JSON.stringify({ endpoint }),
    credentials: "include",
  });
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}
