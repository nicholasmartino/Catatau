import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema.js";

describe("config schema", () => {
  it("applies all defaults when given empty object", () => {
    const result = configSchema.parse({});
    expect(result.bcparksBaseUrl).toBe("https://camping.bcparks.ca");
    expect(result.requestDelayMs).toBe(500);
    expect(result.sessionCacheTtlMinutes).toBe(30);
    expect(result.monitorIntervalSeconds).toBe(300);
    expect(result.morningCheckEnabled).toBe(true);
    expect(result.morningPreCheckSeconds).toBe(5);
    expect(result.bookingHeadless).toBe(false);
    expect(result.defaultPartySize).toBe(2);
    expect(result.defaultEquipmentCategoryId).toBe(-32768);
  });

  it("coerces string numbers", () => {
    const result = configSchema.parse({
      requestDelayMs: "1000",
      defaultPartySize: "4",
      monitorIntervalSeconds: "60",
    });
    expect(result.requestDelayMs).toBe(1000);
    expect(result.defaultPartySize).toBe(4);
    expect(result.monitorIntervalSeconds).toBe(60);
  });

  it("transforms boolean strings", () => {
    const result = configSchema.parse({
      morningCheckEnabled: "false",
      bookingHeadless: "true",
    });
    expect(result.morningCheckEnabled).toBe(false);
    expect(result.bookingHeadless).toBe(true);
  });

  it("accepts optional email config", () => {
    const result = configSchema.parse({
      smtpHost: "smtp.gmail.com",
      smtpPort: "587",
      smtpUser: "user@gmail.com",
      smtpPass: "pass123",
      notifyEmailTo: "notify@gmail.com",
    });
    expect(result.smtpHost).toBe("smtp.gmail.com");
    expect(result.smtpPort).toBe(587);
  });

  it("accepts empty string for optional webhook URLs", () => {
    const result = configSchema.parse({
      discordWebhookUrl: "",
      slackWebhookUrl: "",
    });
    expect(result.discordWebhookUrl).toBe("");
    expect(result.slackWebhookUrl).toBe("");
  });

  it("rejects invalid URL for base URL", () => {
    expect(() =>
      configSchema.parse({ bcparksBaseUrl: "not-a-url" }),
    ).toThrow();
  });

  it("rejects negative party size", () => {
    expect(() =>
      configSchema.parse({ defaultPartySize: "0" }),
    ).toThrow();
  });
});
