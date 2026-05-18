import "dotenv/config";
import { configSchema, type AppConfig } from "./schema.js";

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config) return _config;

  const raw = {
    bcparksBaseUrl: process.env.BCPARKS_BASE_URL,
    requestDelayMs: process.env.REQUEST_DELAY_MS,
    sessionCacheTtlMinutes: process.env.SESSION_CACHE_TTL_MINUTES,
    monitorIntervalSeconds: process.env.MONITOR_INTERVAL_SECONDS,
    morningCheckEnabled: process.env.MORNING_CHECK_ENABLED,
    morningPreCheckSeconds: process.env.MORNING_PRE_CHECK_SECONDS,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    notifyEmailTo: process.env.NOTIFY_EMAIL_TO,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    autoCartEnabled: process.env.AUTO_CART_ENABLED,
    autoCartHeadless: process.env.AUTO_CART_HEADLESS,
    bookingHeadless: process.env.BOOKING_HEADLESS,
    defaultPartySize: process.env.DEFAULT_PARTY_SIZE,
    defaultEquipmentCategoryId: process.env.DEFAULT_EQUIPMENT_CATEGORY_ID,
    opencodeApiUrl: process.env.OPENCODE_API_URL,
  };

  _config = configSchema.parse(raw);
  return _config;
}

export { type AppConfig } from "./schema.js";
