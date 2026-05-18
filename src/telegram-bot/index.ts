import { loadConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { extractIntent } from "../llm/extractor.js";
import { startMonitor } from "../availability/monitor.js";
import { checkAvailability, findCampgrounds } from "../availability/checker.js";
import { parseDate, formatDate } from "../utils/dates.js";
import type { ExtractedIntent } from "../llm/types.js";

const TELEGRAM_API = "https://api.telegram.org";

let currentAbortController: AbortController | null = null;
let currentOperation: string | null = null;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    from?: { id: number; is_bot?: boolean };
  };
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
        text,
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
      "`/stop` - Cancel current operation",
      "`/status` - Show current operation",
      "`/help` - Show this message",
    ].join("\n"),
  );
}

async function handleCommandMessage(
  chatId: number,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "/stop") return handleStop(chatId);
  if (lower === "/status") return handleStatus(chatId);
  if (lower === "/help" || lower === "/start") return handleHelp(chatId);

  let command: string | null = null;
  let args = "";
  for (const cmd of ["/hunt", "/monitor", "/check", "/snatch"]) {
    if (lower.startsWith(cmd)) {
      command = cmd.slice(1);
      args = trimmed.slice(cmd.length).trim();
      break;
    }
  }

  if (!command) {
    await sendMessage(
      chatId,
      "Unknown command. Send `/help` to see available commands.",
    );
    return;
  }

  if (!args) {
    await sendMessage(
      chatId,
      `Please describe what you want after the command.\n*Example:* \`/${command} golden ears june 1 to june 3\``,
    );
    return;
  }

  await sendMessage(chatId, "Understanding your request...");
  let intent: ExtractedIntent;
  try {
    intent = await extractIntent(args);
  } catch (error) {
    await sendMessage(
      chatId,
      `Sorry, I couldn't understand that request.\nError: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  if (!intent.park) {
    await sendMessage(
      chatId,
      "I couldn't identify a park name in your message. Please try again with a park name.",
    );
    return;
  }

  if (command === "hunt" || command === "monitor" || command === "check") {
    if (!intent.startDate || !intent.endDate) {
      await sendMessage(
        chatId,
        "I couldn't determine the dates. Please include start and end dates.\n*Example:* `june 1 to june 3`",
      );
      return;
    }
  }

  switch (command) {
    case "hunt":
      await executeHunt(chatId, intent);
      break;
    case "monitor":
      await executeMonitor(chatId, intent);
      break;
    case "check":
      await executeCheck(chatId, intent);
      break;
    case "snatch":
      await sendMessage(
        chatId,
        "Snatch mode is not yet supported via Telegram bot.",
      );
      break;
  }
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

  logger.info("Starting Telegram bot...");
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
        await handleCommandMessage(msg.chat.id, msg.text);
      }
    } catch (error) {
      logger.error(error instanceof Error ? error : new Error(String(error)));
      await sleep(5000);
    }
  }
}
