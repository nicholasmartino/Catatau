import type { AvailableSite } from "./availability.js";

export interface NotificationPayload {
  title: string;
  message: string;
  sites: AvailableSite[];
  bookingUrls: string[];
  parkName: string;
  startDate: string;
  endDate: string;
}

export interface NotificationProvider {
  name: string;
  isConfigured(): boolean;
  send(payload: NotificationPayload): Promise<void>;
}
