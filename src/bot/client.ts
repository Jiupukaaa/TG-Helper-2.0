import { Bot } from "grammy";
import { env } from "@/lib/env";

// Single Bot instance reused by webhook updates and the Worker's scheduled event.
let botInstance: Bot | undefined;

export function getBot(): Bot {
  if (!botInstance) {
    botInstance = new Bot(env.TELEGRAM_BOT_TOKEN);
  }
  return botInstance;
}
