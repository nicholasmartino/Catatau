import nodemailer from "nodemailer";
import type {
  NotificationProvider,
  NotificationPayload,
} from "../types/notification.js";
import { loadConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";

export class EmailNotifier implements NotificationProvider {
  name = "email";

  isConfigured(): boolean {
    const config = loadConfig();
    return !!(
      config.smtpHost &&
      config.smtpUser &&
      config.smtpPass &&
      config.notifyEmailTo
    );
  }

  async send(payload: NotificationPayload): Promise<void> {
    const config = loadConfig();

    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort || 587,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });

    const siteList = payload.sites
      .map(
        (s) =>
          `<li><strong>${s.siteName}</strong> at ${s.campgroundName}</li>`,
      )
      .join("\n");

    const urlList = payload.bookingUrls
      .map((u) => `<li><a href="${u}">Book Now</a></li>`)
      .join("\n");

    const html = `
      <h2>${payload.title}</h2>
      <p>${payload.message}</p>
      <h3>Available Sites (${payload.sites.length})</h3>
      <ul>${siteList}</ul>
      <h3>Quick Booking Links</h3>
      <ul>${urlList}</ul>
      <p><em>Park: ${payload.parkName} | Dates: ${payload.startDate} to ${payload.endDate}</em></p>
    `;

    await transporter.sendMail({
      from: config.smtpUser,
      to: config.notifyEmailTo,
      subject: `🏕️ ${payload.title}`,
      html,
    });

    logger.info("Email notification sent to %s", config.notifyEmailTo);
  }
}
