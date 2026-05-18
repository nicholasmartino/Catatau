import { Command } from "commander";
import { startTelegramBot } from "../../telegram-bot/index.js";
import { printHeader } from "../formatters.js";

export const telegramBotCommand = new Command("telegram-bot")
  .description(
    "Start the Telegram bot with LLM-powered intent extraction (requires opencode serve)",
  )
  .action(async () => {
    printHeader("Telegram Bot");
    console.log(
      "Waiting for Telegram messages... (requires opencode serve on :4096)",
    );
    await startTelegramBot();
  });
