export type BotCommand = "hunt" | "monitor" | "check" | "snatch" | "stop";

export interface ExtractedIntent {
  reply?: string;
  park?: string;
  startDate?: string;
  endDate?: string;
  nights?: number;
  partySize?: number;
  interval?: number;
}

export interface StopIntent {
  reply: string;
  huntIds: string[];
  stopAll: boolean;
}
