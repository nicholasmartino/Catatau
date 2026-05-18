import { createOpencodeServer } from "@opencode-ai/sdk/server";
import { loadConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { startMonitor } from "../availability/monitor.js";
import { checkAvailability, findCampgrounds, listAllCampgrounds } from "../availability/checker.js";
import { parseDate } from "../utils/dates.js";
import { ConversationManager } from "./conversation.js";
import type { ExtractedIntent } from "../llm/types.js";
import type { ProcessMessageResult } from "./conversation.js";

const TELEGRAM_API = "https://api.telegram.org";

let currentAbortController: AbortController | null = null;
let currentOperation: string | null = null;
const conversationManager = new ConversationManager();

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

async function handleStop(chatId: number): Promise<void> {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    currentOperation = null;
    await sendMessage(chatId, "Stopped current operation.");
  } else {
    await sendMessage(chatId, "No operation is currently running.");
  }
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
  if (currentOperation) {
    await sendMessage(chatId, `*Active operation:*\n${currentOperation}`);
  } else {
    await sendMessage(chatId, "No operation is currently running.");
  }
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
      "`/stop` - Cancel current operation",
      "`/status` - Show current operation",
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

  if (currentAbortController) {
    currentAbortController.abort();
  }

  const ac = new AbortController();
  currentAbortController = ac;
  currentOperation = `Hunting *${park}* (${intent.startDate} -> ${intent.endDate}) - interval ${interval}s, party ${partySize}`;

  const confirmMsg = [
    `*Hunt started for ${park}!*`,
    `  Date: ${intent.startDate} -> ${intent.endDate}`,
    `  Party size: ${partySize}`,
    `  Checking every ${interval}s with auto-cart enabled`,
    "",
    "_You'll be notified here when sites are found._",
  ].join("\n");
  await sendMessage(chatId, confirmMsg);

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
      if (currentAbortController === ac) {
        currentAbortController = null;
        currentOperation = null;
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

  if (currentAbortController) {
    currentAbortController.abort();
  }

  const ac = new AbortController();
  currentAbortController = ac;
  currentOperation = `Monitoring *${park}* (${intent.startDate} -> ${intent.endDate}) - interval ${interval}s, party ${partySize}`;

  const confirmMsg = [
    `*Monitoring started for ${park}!*`,
    `  Date: ${intent.startDate} -> ${intent.endDate}`,
    `  Party size: ${partySize}`,
    `  Checking every ${interval}s`,
    "",
    "_You'll be notified here when sites are found._",
  ].join("\n");
  await sendMessage(chatId, confirmMsg);

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
      if (currentAbortController === ac) {
        currentAbortController = null;
        currentOperation = null;
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
    if (currentAbortController) currentAbortController.abort();
    opencodeServer?.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

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
