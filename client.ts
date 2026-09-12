import { Bot } from "grammy";
import { env } from "@/lib/env";

// Single Bot instance reused across the webhook handler and the cron
// handler (the cron endpoint needs it to push reminder messages proactively,
// outside of any incoming update).
let botInstance: Bot | undefined;

export function getBot(): Bot {
  if (!botInstance) {
    botInstance = new Bot(env.TELEGRAM_BOT_TOKEN);
  }
  return botInstance;
}
