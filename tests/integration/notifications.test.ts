import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotificationPayload } from "../../src/types/notification.js";

// Mock config for notification tests
vi.mock("../../src/config/index.js", () => ({
  loadConfig: vi.fn(() => ({
    smtpHost: undefined,
    smtpUser: undefined,
    smtpPass: undefined,
    notifyEmailTo: undefined,
    discordWebhookUrl: "",
    slackWebhookUrl: "",
  })),
}));

import { ConsoleNotifier } from "../../src/notifications/console.js";
import { EmailNotifier } from "../../src/notifications/email.js";
import { DiscordWebhookNotifier, SlackWebhookNotifier } from "../../src/notifications/webhook.js";
import { NotificationManager } from "../../src/notifications/manager.js";

const testPayload: NotificationPayload = {
  title: "Test: 2 sites available at Golden Ears!",
  message: "New availability found for 2026-07-15 to 2026-07-17",
  sites: [
    {
      resourceId: 10001,
      mapId: 1001,
      resourceLocationId: 100,
      campgroundName: "Golden Ears Provincial Park",
      siteName: "Site 10001",
      bookingUrl: "https://camping.bcparks.ca/create-booking/results?mapId=1001",
    },
  ],
  bookingUrls: [
    "https://camping.bcparks.ca/create-booking/results?mapId=1001",
  ],
  parkName: "Golden Ears Provincial Park",
  startDate: "2026-07-15",
  endDate: "2026-07-17",
};

describe("ConsoleNotifier", () => {
  it("is always configured", () => {
    const notifier = new ConsoleNotifier();
    expect(notifier.isConfigured()).toBe(true);
    expect(notifier.name).toBe("console");
  });

  it("sends notification to console", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const notifier = new ConsoleNotifier();
    await notifier.send(testPayload);

    expect(consoleSpy).toHaveBeenCalled();
    const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("Test: 2 sites available");
    expect(allOutput).toContain("Site 10001");

    consoleSpy.mockRestore();
  });
});

describe("EmailNotifier", () => {
  it("reports not configured when SMTP settings missing", () => {
    const notifier = new EmailNotifier();
    expect(notifier.isConfigured()).toBe(false);
  });
});

describe("DiscordWebhookNotifier", () => {
  it("reports not configured when URL is empty", () => {
    const notifier = new DiscordWebhookNotifier();
    expect(notifier.isConfigured()).toBe(false);
  });
});

describe("SlackWebhookNotifier", () => {
  it("reports not configured when URL is empty", () => {
    const notifier = new SlackWebhookNotifier();
    expect(notifier.isConfigured()).toBe(false);
  });
});

describe("NotificationManager", () => {
  it("sends to all configured providers", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const manager = new NotificationManager();

    // Only console should be configured with our mock config
    await manager.notify(testPayload);

    // Console notifier should have fired
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
