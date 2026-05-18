import { z } from "zod";

export const configSchema = z.object({
  bcparksBaseUrl: z
    .string()
    .url()
    .default("https://camping.bcparks.ca"),
  requestDelayMs: z.coerce.number().min(0).default(500),
  sessionCacheTtlMinutes: z.coerce.number().min(1).default(30),

  monitorIntervalSeconds: z.coerce.number().min(10).default(300),
  morningCheckEnabled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("true"),
  morningPreCheckSeconds: z.coerce.number().min(0).default(5),

  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  notifyEmailTo: z.string().optional(),

  discordWebhookUrl: z.string().url().optional().or(z.literal("")),
  slackWebhookUrl: z.string().url().optional().or(z.literal("")),

  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),

  autoCartEnabled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("true"),
  autoCartHeadless: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),

  bookingHeadless: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),

  defaultPartySize: z.coerce.number().min(1).default(2),
  defaultEquipmentCategoryId: z.coerce
    .number()
    .default(-32768),

  opencodeApiUrl: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;
