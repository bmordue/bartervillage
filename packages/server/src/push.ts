/**
 * Web push delivery (spec §11, §12; M7.12).
 *
 * Uses the `web-push` library to send browser push notifications to players
 * when a tick resolves. VAPID keys live in deployment configuration
 * (`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`), generated once with
 * `generateVAPIDKeys` when missing. Push failures are logged and never affect
 * tick resolution (spec §11).
 */

import * as webpush from "web-push";

import type { Database } from "./db/database.js";
import { listPushSubscriptions } from "./db/pushRepository.js";

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** Subject claim for VAPID, e.g. `mailto:admin@example.com`. */
  subject: string;
}

export interface PushDelivery {
  endpoint: string;
  ok: boolean;
  failure?: string;
}

export interface PushService {
  sendTickResolved(db: Database, worldId: string, tick: number): Promise<PushDelivery[]>;
  /** Generate and persist a fresh VAPID key pair into the environment. */
  generateVapidKeys(): { publicKey: string; privateKey: string };
}

function loadConfig(): PushConfig {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@barter-village.local";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required for push notifications");
  }
  return { publicKey, privateKey, subject };
}

function configureWebPush(config: PushConfig): void {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
}

export function createPushService(): PushService {
  let config: PushConfig | undefined;
  let configured = false;

  const ensureConfig = (): PushConfig => {
    if (config === undefined) {
      config = loadConfig();
    }
    if (!configured) {
      configureWebPush(config);
      configured = true;
    }
    return config;
  };

  return {
    generateVapidKeys(): { publicKey: string; privateKey: string } {
      const keys = webpush.generateVAPIDKeys();
      return { publicKey: keys.publicKey, privateKey: keys.privateKey };
    },

    async sendTickResolved(db: Database, worldId: string, tick: number): Promise<PushDelivery[]> {
      ensureConfig();
      const subscriptions = listPushSubscriptions(db, worldId);
      const deliveries: PushDelivery[] = [];
      for (const subscription of subscriptions) {
        const payload = JSON.stringify({
          title: "Barter Village",
          body: `Tick ${tick} has resolved. Tap to watch the replay.`,
          tag: `tick-${tick}`,
          data: { type: "tick_resolved", tick },
        });
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { auth: subscription.auth, p256dh: subscription.p256dh },
            },
            payload,
            { urgency: "normal" },
          );
          deliveries.push({ endpoint: subscription.endpoint, ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`push: failed to notify ${subscription.endpoint}: ${message}`);
          deliveries.push({ endpoint: subscription.endpoint, ok: false, failure: message });
        }
      }
      return deliveries;
    },
  };
}
