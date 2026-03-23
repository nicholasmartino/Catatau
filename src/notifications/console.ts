import type { NotificationProvider, NotificationPayload } from "../types/notification.js";
import { logger } from "../utils/logger.js";

export class ConsoleNotifier implements NotificationProvider {
  name = "console";

  isConfigured(): boolean {
    return true; // always available
  }

  async send(payload: NotificationPayload): Promise<void> {
    const divider = "=".repeat(60);
    console.log(`\n${divider}`);
    console.log(`🏕️  ${payload.title}`);
    console.log(divider);
    console.log(payload.message);

    if (payload.sites.length > 0) {
      console.log(`\nAvailable sites (${payload.sites.length}):`);
      for (const site of payload.sites) {
        console.log(`  - ${site.siteName} at ${site.campgroundName}`);
      }
    }

    if (payload.bookingUrls.length > 0) {
      console.log("\nBooking URLs:");
      for (const url of payload.bookingUrls) {
        console.log(`  ${url}`);
      }
    }

    console.log(divider + "\n");
    logger.info("Console notification sent");
  }
}
