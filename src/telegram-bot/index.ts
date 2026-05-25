import { randomUUID } from "node:crypto";
import { createOpencodeServer } from "@opencode-ai/sdk/server";
import { loadConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { startMonitor } from "../availability/monitor.js";
import { checkAvailability, findCampgrounds, listAllCampgrounds } from "../availability/checker.js";
import { parseDate } from "../utils/dates.js";
import { ConversationManager } from "./conversation.js";
import { loadHunts, saveHunts, addHunt, removeHunts, clearHunts } from "./persistence.js";
import { extractStopIntent } from "../llm/extractor.js";
import type { ExtractedIntent, StopIntent } from "../llm/types.js";
import type { ProcessMessageResult } from "./conversation.js";

const TELEGRAM_API = "https://api.telegram.org";

interface ActiveHunt {
  id: string;
  chatId: number;
  command: "hunt" | "monitor";
  parkName: string;
  startDate: string;
  endDate: string;
  partySize: number;
  intervalSeconds: number;
  autoCart: boolean;
  controller: AbortController;
  startedAt: number;
}

const activeHunts = new Map<string, ActiveHunt>();
const conversationManager = new ConversationManager();
const stopConversations = new Map<number, ActiveHunt[]>();

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    from?: { id: number; is_bot?: boolean };
  };
}

const TELEGRAM_MAX_LENGTH = 4096;

function truncateTelegram(text: string): string {
  if (text.length <= TELEGRAM_MAX_LENGTH) return text;
  return text.slice(0, TELEGRAM_MAX_LENGTH - 30) + "\n\n... (truncated)";
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  const config = loadConfig();
  if (!config.telegramBotToken) return;

  const response = await fetch(
    `${TELEGRAM_API}/bot${config.telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: truncateTelegram(text),
        parse_mode: "Markdown",
        disable_web_page_preview: false,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    logger.error("Failed to send Telegram message: %s", body);
  }
}

async function getUpdates(
  offset: number,
  token: string,
): Promise<TelegramUpdate[]> {
  const url = `${TELEGRAM_API}/bot${token}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message"]`;
  const response = await fetch(url);
  if (!response.ok) {
    logger.error("Failed to get updates: %d", response.status);
    return [];
  }
  const data = (await response.json()) as { ok: boolean; result: TelegramUpdate[] };
  return data.result ?? [];
}

function formatHuntList(hunts: ActiveHunt[]): string {
  return hunts
    .map((h, i) => {
      const type = h.command === "hunt" ? "🔍 Hunt" : "👁 Monitor";
      return `${i + 1}. ${type} — *${h.parkName}* (${h.startDate} → ${h.endDate}) every ${h.intervalSeconds}s`;
    })
    .join("\n");
}

async function stopActiveHunts(ids: string[]): Promise<number> {
  let count = 0;
  for (const id of ids) {
    const hunt = activeHunts.get(id);
    if (hunt) {
      hunt.controller.abort();
      activeHunts.delete(id);
      count++;
    }
  }
  return count;
}

async function handleStop(chatId: number): Promise<void> {
  const hunts = Array.from(activeHunts.values());
  if (hunts.length === 0) {
    await sendMessage(chatId, "No active hunts or monitors to stop.");
    return;
  }

  const list = formatHuntList(hunts);
  stopConversations.set(chatId, hunts);
  await sendMessage(
    chatId,
    `*Active hunts/monitors:*\n${list}\n\nWhich would you like to stop? (say number, name, or "all")`,
  );
}

async function handleStopSelection(
  chatId: number,
  text: string,
  apiUrl: string,
): Promise<void> {
  const hunts = stopConversations.get(chatId);
  if (!hunts) return;

  stopConversations.delete(chatId);

  const huntsList = formatHuntList(hunts);
  let stopIntent: StopIntent;

  try {
    stopIntent = await extractStopIntent(text, apiUrl, huntsList);
  } catch {
    await sendMessage(chatId, "I couldn't process that. Please try `/stop` again.");
    return;
  }

  if (stopIntent.stopAll) {
    const ids = hunts.map((h) => h.id);
    const count = await stopActiveHunts(ids);
    removeHunts(ids);
    await sendMessage(chatId, `Stopped all ${count} active hunts/monitors.`);
    return;
  }

  if (stopIntent.huntIds.length === 0) {
    await sendMessage(chatId, stopIntent.reply || "No hunts matched. Try again with `/stop`.");
    return;
  }

  const ids: string[] = [];
  for (const displayId of stopIntent.huntIds) {
    const idx = parseInt(displayId, 10) - 1;
    const hunt = hunts[idx];
    if (hunt) ids.push(hunt.id);
  }

  const count = await stopActiveHunts(ids);
  if (ids.length > 0) removeHunts(ids);

  await sendMessage(
    chatId,
    `Stopped ${count} hunt${count !== 1 ? "s" : ""}.`,
  );
}

async function handleList(chatId: number): Promise<void> {
  await sendMessage(chatId, "Fetching available campgrounds...");
  try {
    const campgrounds = await listAllCampgrounds();
    const parkNames = campgrounds.map(c => `• ${c.name}`);
    const total = parkNames.length;

    const header = `*BC Parks Campgrounds (${total} total)*\n`;
    const maxLen = 4000;

    if (total === 0) {
      await sendMessage(chatId, "No reservable campgrounds found.");
      return;
    }

    const chunks: string[] = [];
    let current = header;
    for (const line of parkNames) {
      if ((current + "\n" + line).length > maxLen) {
        chunks.push(current);
        current = header + line;
      } else {
        current += "\n" + line;
      }
    }
    chunks.push(current);

    for (const chunk of chunks) {
      await sendMessage(chatId, chunk);
    }
  } catch (error) {
    await sendMessage(
      chatId,
      `Error fetching campground list: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function handleStatus(chatId: number): Promise<void> {
  const hunts = Array.from(activeHunts.values());
  if (hunts.length === 0) {
    await sendMessage(chatId, "No operations are currently running.");
    return;
  }

  const list = formatHuntList(hunts);
  await sendMessage(chatId, `*Active operations (${hunts.length}):*\n${list}`);
}

async function handleHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    [
      "*Available commands:*",
      "",
      "`/hunt <description>` - Monitor with auto-cart (30s interval)",
      "  *Example:* `/hunt golden ears june 1 to june 3 for 2 people`",
      "",
      "`/monitor <description>` - Monitor without auto-cart (300s interval)",
      "  *Example:* `/monitor manning park next weekend for 4`",
      "",
      "`/check <description>` - Single availability check",
      "  *Example:* `/check rathtrevor beach aug 5 to aug 7`",
      "",
      "`/list` - List all reservable campgrounds",
      "`/stop` - Stop active hunts/monitors",
      "`/status` - Show active operations",
      "`/help` - Show this message",
    ].join("\n"),
  );
}

async function handleConversationResult(
  chatId: number,
  result: ProcessMessageResult,
): Promise<void> {
  switch (result.action) {
    case "execute":
      if (!result.intent) {
        await sendMessage(chatId, "Something went wrong. Try again.");
        return;
      }
      switch (result.command) {
        case "hunt":
          await executeHunt(chatId, result.intent);
          break;
        case "monitor":
          await executeMonitor(chatId, result.intent);
          break;
        case "check":
          await executeCheck(chatId, result.intent);
          break;
      }
      break;
    case "ask":
      if (result.question) await sendMessage(chatId, result.question);
      break;
    case "expired":
      await sendMessage(
        chatId,
        "Your previous request expired. Send a new command to start again.",
      );
      break;
  }
}

async function handleCommandMessage(
  chatId: number,
  text: string,
  apiUrl: string,
): Promise<void> {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "/stop") {
    conversationManager.delete(chatId);
    stopConversations.delete(chatId);
    return handleStop(chatId);
  }
  if (lower === "/status") return handleStatus(chatId);
  if (lower === "/help" || lower === "/start") return handleHelp(chatId);
  if (lower === "/list") {
    conversationManager.delete(chatId);
    return handleList(chatId);
  }

  let command: string | null = null;
  let args = "";
  for (const cmd of ["/hunt", "/monitor", "/check", "/snatch"]) {
    if (lower.startsWith(cmd)) {
      command = cmd.slice(1);
      args = trimmed.slice(cmd.length).trim();
      break;
    }
  }

  if (command) {
    if (command === "snatch") {
      await sendMessage(
        chatId,
        "Snatch mode is not yet supported via Telegram bot.",
      );
      return;
    }

    conversationManager.start(chatId, command);

    if (!args) {
      const question = conversationManager.getQuestion(chatId);
      if (question) await sendMessage(chatId, question);
      return;
    }

    await sendMessage(chatId, "Let me process that...");
    try {
      const result = await conversationManager.processMessage(
        chatId,
        args,
        apiUrl,
      );
      await handleConversationResult(chatId, result);
    } catch (error) {
      await sendMessage(
        chatId,
        `Sorry, I couldn't understand that.\n${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return;
  }

  if (stopConversations.has(chatId)) {
    return handleStopSelection(chatId, trimmed, apiUrl);
  }

  if (conversationManager.has(chatId)) {
    await sendMessage(chatId, "Let me process that...");
    try {
      const result = await conversationManager.processMessage(
        chatId,
        trimmed,
        apiUrl,
      );
      await handleConversationResult(chatId, result);
    } catch (error) {
      await sendMessage(
        chatId,
        `Sorry, I couldn't understand that.\n${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return;
  }

  await sendMessage(
    chatId,
    "Unknown command. Send /help to see available commands.",
  );
}

async function executeHunt(
  chatId: number,
  intent: ExtractedIntent,
): Promise<void> {
  const config = loadConfig();
  const park = intent.park!;
  const startDate = parseDate(intent.startDate!);
  const endDate = parseDate(intent.endDate!);
  const partySize = intent.partySize ?? config.defaultPartySize;
  const interval = intent.interval ?? 30;

  const campgrounds = await findCampgrounds(park);
  if (campgrounds.length === 0) {
    await sendMessage(chatId, `No campgrounds found matching "${park}". Use /list to see available parks.`);
    return;
  }

  const id = randomUUID();
  const ac = new AbortController();
  const hunt: ActiveHunt = {
    id,
    chatId,
    command: "hunt",
    parkName: park,
    startDate: intent.startDate!,
    endDate: intent.endDate!,
    partySize,
    intervalSeconds: interval,
    autoCart: true,
    controller: ac,
    startedAt: Date.now(),
  };
  activeHunts.set(id, hunt);

  const displayIdx = Array.from(activeHunts.keys()).indexOf(id) + 1;

  const confirmMsg = [
    `*Hunt #${displayIdx} started for ${park}!*`,
    `  Date: ${intent.startDate} -> ${intent.endDate}`,
    `  Party size: ${partySize}`,
    `  Checking every ${interval}s with auto-cart enabled`,
    "",
    "_You'll be notified here when sites are found._",
  ].join("\n");
  await sendMessage(chatId, confirmMsg);

  addHunt({
    id,
    chatId,
    command: "hunt",
    parkName: park,
    startDate: intent.startDate!,
    endDate: intent.endDate!,
    partySize,
    intervalSeconds: interval,
    autoCart: true,
  });

  startMonitor({
    parkName: park,
    startDate,
    endDate,
    partySize,
    intervalSeconds: interval,
    autoCart: true,
    signal: ac.signal,
  })
    .catch(async (error) => {
      if (error.name !== "AbortError") {
        await sendMessage(chatId, `Hunt error: ${error.message}`);
      }
    })
    .finally(() => {
      if (activeHunts.get(id)?.controller === ac) {
        activeHunts.delete(id);
        removeHunts([id]);
      }
    });
}

async function executeMonitor(
  chatId: number,
  intent: ExtractedIntent,
): Promise<void> {
  const config = loadConfig();
  const park = intent.park!;
  const startDate = parseDate(intent.startDate!);
  const endDate = parseDate(intent.endDate!);
  const partySize = intent.partySize ?? config.defaultPartySize;
  const interval = intent.interval ?? config.monitorIntervalSeconds;

  const campgrounds = await findCampgrounds(park);
  if (campgrounds.length === 0) {
    await sendMessage(chatId, `No campgrounds found matching "${park}". Use /list to see available parks.`);
    return;
  }

  const id = randomUUID();
  const ac = new AbortController();
  const hunt: ActiveHunt = {
    id,
    chatId,
    command: "monitor",
    parkName: park,
    startDate: intent.startDate!,
    endDate: intent.endDate!,
    partySize,
    intervalSeconds: interval,
    autoCart: false,
    controller: ac,
    startedAt: Date.now(),
  };
  activeHunts.set(id, hunt);

  const displayIdx = Array.from(activeHunts.keys()).indexOf(id) + 1;

  const confirmMsg = [
    `*Monitor #${displayIdx} started for ${park}!*`,
    `  Date: ${intent.startDate} -> ${intent.endDate}`,
    `  Party size: ${partySize}`,
    `  Checking every ${interval}s`,
    "",
    "_You'll be notified here when sites are found._",
  ].join("\n");
  await sendMessage(chatId, confirmMsg);

  addHunt({
    id,
    chatId,
    command: "monitor",
    parkName: park,
    startDate: intent.startDate!,
    endDate: intent.endDate!,
    partySize,
    intervalSeconds: interval,
    autoCart: false,
  });

  startMonitor({
    parkName: park,
    startDate,
    endDate,
    partySize,
    intervalSeconds: interval,
    signal: ac.signal,
  })
    .catch(async (error) => {
      if (error.name !== "AbortError") {
        await sendMessage(chatId, `Monitor error: ${error.message}`);
      }
    })
    .finally(() => {
      if (activeHunts.get(id)?.controller === ac) {
        activeHunts.delete(id);
        removeHunts([id]);
      }
    });
}

async function executeCheck(
  chatId: number,
  intent: ExtractedIntent,
): Promise<void> {
  const config = loadConfig();
  const park = intent.park!;
  const startDate = parseDate(intent.startDate!);
  const endDate = parseDate(intent.endDate!);
  const partySize = intent.partySize ?? config.defaultPartySize;

  await sendMessage(
    chatId,
    `Checking *${park}* for ${intent.startDate} -> ${intent.endDate}...`,
  );

  try {
    const campgrounds = await findCampgrounds(park);
    if (campgrounds.length === 0) {
      await sendMessage(chatId, `No campgrounds found matching "${park}".`);
      return;
    }

    let totalSites = 0;
    const results: string[] = [];

    for (const campground of campgrounds) {
      const sites = await checkAvailability({
        campground,
        startDate,
        endDate,
        partySize,
      });

      if (sites.length > 0) {
        totalSites += sites.length;
        results.push(
          `*${campground.name}:* ${sites.length} sites available`,
          ...sites.slice(0, 5).map(
            (s, i) => `${i + 1}. ${s.siteName} - [Book](${s.bookingUrl})`,
          ),
        );
        if (sites.length > 5) {
          results.push(`  _...and ${sites.length - 5} more_`);
        }
        if (campgrounds.length === 1 && sites.length > 0) {
          const firstUrl = sites[0].bookingUrl;
          results.push("", `[View in browser](${firstUrl})`);
        }
      } else {
        results.push(`*${campground.name}:* No availability`);
      }
    }

    if (totalSites > 0) {
      await sendMessage(
        chatId,
        [
          `*${totalSites} site${totalSites > 1 ? "s" : ""} available at ${park}!*`,
          "",
          ...results,
        ].join("\n"),
      );
    } else {
      await sendMessage(
        chatId,
        [
          `No availability found for *${park}*`,
          `  ${intent.startDate} -> ${intent.endDate}`,
          `  Party size: ${partySize}`,
        ].join("\n"),
      );
    }
  } catch (error) {
    await sendMessage(
      chatId,
      `Error checking availability: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function startTelegramBot(): Promise<void> {
  const config = loadConfig();
  if (!config.telegramBotToken) {
    logger.error("TELEGRAM_BOT_TOKEN is required to start the Telegram bot");
    return;
  }

  let opencodeUrl: string;
  let opencodeServer: { close(): void } | null = null;

  if (config.opencodeApiUrl) {
    opencodeUrl = config.opencodeApiUrl;
    logger.info("Connecting to opencode server at %s", opencodeUrl);
  } else {
    logger.info("Starting embedded opencode server...");
    try {
      const server = await createOpencodeServer({ port: 0 });
      opencodeServer = server;
      opencodeUrl = server.url;
      logger.info("Opencode server running at %s", opencodeUrl);
    } catch (error) {
      logger.error(
        error instanceof Error ? error : new Error(String(error)),
        "Failed to start opencode server",
      );
      return;
    }
  }

  const shutdown = () => {
    logger.info("Shutting down...");
    for (const hunt of activeHunts.values()) {
      hunt.controller.abort();
    }
    opencodeServer?.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Restore persisted hunts from previous session
  const savedHunts = loadHunts();
  const expiredHunts = savedHunts.filter(
    (h) => new Date(h.endDate) < new Date(),
  );
  const activePersisted = savedHunts.filter(
    (h) => new Date(h.endDate) >= new Date(),
  );
  if (expiredHunts.length > 0) {
    saveHunts(activePersisted);
  }

  for (const saved of activePersisted) {
    const startDate = parseDate(saved.startDate);
    const endDate = parseDate(saved.endDate);

    const ac = new AbortController();
    const hunt: ActiveHunt = {
      id: saved.id,
      chatId: saved.chatId,
      command: saved.command,
      parkName: saved.parkName,
      startDate: saved.startDate,
      endDate: saved.endDate,
      partySize: saved.partySize,
      intervalSeconds: saved.intervalSeconds,
      autoCart: saved.autoCart,
      controller: ac,
      startedAt: Date.now(),
    };
    activeHunts.set(hunt.id, hunt);

    logger.info("Restoring %s for %s", saved.command, saved.parkName);

    startMonitor({
      parkName: saved.parkName,
      startDate,
      endDate,
      partySize: saved.partySize,
      intervalSeconds: saved.intervalSeconds,
      autoCart: saved.autoCart,
      signal: ac.signal,
    })
      .catch(async (error) => {
        if (error.name !== "AbortError") {
          await sendMessage(
            saved.chatId,
            `Restored monitor error: ${error.message}`,
          );
        }
      })
      .finally(() => {
        if (activeHunts.get(hunt.id)?.controller === ac) {
          activeHunts.delete(hunt.id);
          removeHunts([hunt.id]);
        }
      });

    await sendMessage(
      saved.chatId,
      `Restored ${saved.command} from previous session:\n${saved.parkName} (${saved.startDate} -> ${saved.endDate})`,
    );
  }

  logger.info("Telegram bot started. Waiting for messages...");
  let offset = 0;

  while (true) {
    try {
      const updates = await getUpdates(offset, config.telegramBotToken);
      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text || msg.from?.is_bot) continue;

        if (config.telegramChatId && String(msg.chat.id) !== config.telegramChatId) {
          continue;
        }

        logger.info("Received message: %s", msg.text);
        await handleCommandMessage(msg.chat.id, msg.text, opencodeUrl);
      }
    } catch (error) {
      logger.error(error instanceof Error ? error : new Error(String(error)));
      await sleep(5000);
    }
  }
}
