import type {
  NotificationProvider,
  NotificationPayload,
} from "../types/notification.js";
import { loadConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";

export class DiscordWebhookNotifier implements NotificationProvider {
  name = "discord";

  isConfigured(): boolean {
    const config = loadConfig();
    return !!config.discordWebhookUrl;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const config = loadConfig();
    if (!config.discordWebhookUrl) return;

    const siteList = payload.sites
      .map((s) => `• **${s.siteName}** at ${s.campgroundName}`)
      .join("\n");

    const urlList = payload.bookingUrls
      .map((u) => `[Book Now](${u})`)
      .join("\n");

    const content = [
      `## ${payload.title}`,
      payload.message,
      "",
      `**Available Sites (${payload.sites.length}):**`,
      siteList,
      "",
      "**Booking Links:**",
      urlList,
      "",
      `*${payload.parkName} | ${payload.startDate} → ${payload.endDate}*`,
    ].join("\n");

    const response = await fetch(config.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status}`);
    }

    logger.info("Discord notification sent");
  }
}

export class SlackWebhookNotifier implements NotificationProvider {
  name = "slack";

  isConfigured(): boolean {
    const config = loadConfig();
    return !!config.slackWebhookUrl;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const config = loadConfig();
    if (!config.slackWebhookUrl) return;

    const siteList = payload.sites
      .map((s) => `• *${s.siteName}* at ${s.campgroundName}`)
      .join("\n");

    const text = [
      `*${payload.title}*`,
      payload.message,
      "",
      `*Available Sites (${payload.sites.length}):*`,
      siteList,
      "",
      `_${payload.parkName} | ${payload.startDate} → ${payload.endDate}_`,
      "",
      payload.bookingUrls.map((u) => `<${u}|Book Now>`).join(" | "),
    ].join("\n");

    const response = await fetch(config.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status}`);
    }

    logger.info("Slack notification sent");
  }
}
