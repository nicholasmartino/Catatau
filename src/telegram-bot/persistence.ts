import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { logger } from "../utils/logger.js";

const STATE_PATH = "hunts.json";

export interface PersistedHunt {
  id: string;
  chatId: number;
  command: "hunt" | "monitor";
  parkName: string;
  startDate: string;
  endDate: string;
  partySize: number;
  intervalSeconds: number;
  autoCart: boolean;
}

export function loadHunts(): PersistedHunt[] {
  try {
    if (!existsSync(STATE_PATH)) return [];
    const data = readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(data) as PersistedHunt[];
  } catch {
    return [];
  }
}

export function saveHunts(hunts: PersistedHunt[]): void {
  try {
    writeFileSync(STATE_PATH, JSON.stringify(hunts, null, 2));
  } catch (error) {
    logger.error({ error }, "Failed to save hunts");
  }
}

export function addHunt(hunt: PersistedHunt): void {
  const hunts = loadHunts();
  hunts.push(hunt);
  saveHunts(hunts);
}

export function removeHunts(ids: string[]): void {
  const idSet = new Set(ids);
  const hunts = loadHunts().filter((h) => !idSet.has(h.id));
  saveHunts(hunts);
}

export function clearHunts(): void {
  saveHunts([]);
}
