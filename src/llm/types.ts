export type BotCommand = "hunt" | "monitor" | "check" | "snatch";

export interface ExtractedIntent {
  park?: string;
  startDate?: string;
  endDate?: string;
  nights?: number;
  partySize?: number;
  interval?: number;
}
