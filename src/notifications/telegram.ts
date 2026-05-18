import type {
  NotificationProvider,
  NotificationPayload,
} from "../types/notification.js";
import { loadConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";

const TELEGRAM_API = "https://api.telegram.org";

export class TelegramNotifier implements NotificationProvider {
  name = "telegram";

  isConfigured(): boolean {
    const config = loadConfig();
    return !!(config.telegramBotToken && config.telegramChatId);
  }

  async send(payload: NotificationPayload): Promise<void> {
    const config = loadConfig();
    if (!config.telegramBotToken || !config.telegramChatId) return;

    const siteList = payload.sites
      .slice(0, 10)
      .map((s, i) => `${i + 1}. ${s.siteName} at ${s.campgroundName}`)
      .join("\n");

    const urlList = payload.bookingUrls
      .map((u) => `${u}`)
      .join("\n");

    const text = [
      `🏕 *${payload.title}*`,
      payload.message,
      "",
      payload.sites.length > 0
        ? `*Available Sites (${payload.sites.length}):*\n${siteList}`
        : "",
      "",
      payload.bookingUrls.length > 0
        ? `*Booking Links:*\n${urlList}`
        : "",
      "",
      `_${payload.parkName} | ${payload.startDate} → ${payload.endDate}_`,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await fetch(
      `${TELEGRAM_API}/bot${config.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: false,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API failed: ${response.status} - ${body}`);
    }

    logger.info("Telegram notification sent");
  }
}
