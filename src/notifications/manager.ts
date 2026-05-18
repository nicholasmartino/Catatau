import type {
  NotificationProvider,
  NotificationPayload,
} from "../types/notification.js";
import { ConsoleNotifier } from "./console.js";
import { EmailNotifier } from "./email.js";
import { DiscordWebhookNotifier, SlackWebhookNotifier } from "./webhook.js";
import { TelegramNotifier } from "./telegram.js";
import { logger } from "../utils/logger.js";

export class NotificationManager {
  private providers: NotificationProvider[] = [];

  constructor() {
    this.providers.push(new ConsoleNotifier());
    this.providers.push(new EmailNotifier());
    this.providers.push(new DiscordWebhookNotifier());
    this.providers.push(new SlackWebhookNotifier());
    this.providers.push(new TelegramNotifier());
  }

  async notify(payload: NotificationPayload): Promise<void> {
    const active = this.providers.filter((p) => p.isConfigured());

    logger.debug(
      "Sending notification via %d providers: %s",
      active.length,
      active.map((p) => p.name).join(", "),
    );

    const results = await Promise.allSettled(
      active.map((provider) =>
        provider.send(payload).catch((error) => {
          logger.error(
            { error, provider: provider.name },
            "Notification provider failed",
          );
        }),
      ),
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      logger.warn("%d notification providers failed", failed.length);
    }
  }
}
