import { Bot, webhookCallback } from "grammy";
import { registerHandlers } from "@/bot/commands";
import { env as runtimeSecrets, setRuntimeEnv, type RuntimeEnv } from "@/lib/env";
import { setDB } from "@/db/client";
import { claimDueReminders, markReminderFailed, markReminderSent } from "@/services/remindersService";
import { cleanupPastShifts } from "@/services/shiftsService";
import { claimWebhookUpdate } from "@/services/webhookDedupService";
import { formatLocalDateTime } from "@/lib/time";

type Env = RuntimeEnv;

let botInstance: Bot | undefined;
let commandSetupAttempted = false;

function getBot(): Bot {
  if (botInstance) return botInstance;
  const bot = new Bot(runtimeSecrets.TELEGRAM_BOT_TOKEN);
  bot.catch((err) => {
    console.error("Telegram update processing failed:", err.message);
  });
  registerHandlers(bot);
  botInstance = bot;
  return bot;
}

async function ensureBotCommands(bot: Bot): Promise<void> {
  if (commandSetupAttempted) return;
  commandSetupAttempted = true;
  try {
    await bot.api.setMyCommands([]);
    await bot.api.setChatMenuButton({ menu_button: { type: "default" } });
  } catch (error) {
    console.error("Telegram bot menu configuration failed:", error instanceof Error ? error.message : String(error));
  }
}

function isPermanentTelegramError(error: unknown): boolean {
  const value = error as { description?: string; error_code?: number };
  if (value?.error_code === 403) return true;
  const description = value?.description ?? "";
  return /chat not found|user is deactivated/i.test(description);
}

async function dispatchReminders(): Promise<{ cleanedShifts: number; claimed: number; sent: number; failed: number }> {
  const bot = getBot();
  const cleanedShifts = await cleanupPastShifts();
  const claimed = await claimDueReminders();
  let sent = 0;
  let failed = 0;

  for (const reminder of claimed) {
    try {
      const chatId = reminder.owner.telegramId;
      if (reminder.voiceFileId) {
        await bot.api.sendVoice(chatId, reminder.voiceFileId, {
          caption: `⏰ Напоминание (${formatLocalDateTime(reminder.dueAt, reminder.owner.timezone)})`,
        });
      } else {
        const localTime = formatLocalDateTime(reminder.dueAt, reminder.owner.timezone);
        await bot.api.sendMessage(chatId, `⏰ Напоминание (${localTime}):\\n${reminder.text}`);
      }
      await markReminderSent(reminder.id);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await markReminderFailed(reminder.id, message, isPermanentTelegramError(error));
      failed += 1;
      console.error("Reminder delivery failed for reminder", reminder.id, message);
    }
  }

  return { cleanedShifts, claimed: claimed.length, sent, failed };
}

async function initializeRequest(env: Env): Promise<void> {
  setRuntimeEnv(env);
  setDB(env.DB);
  await env.DB.exec("PRAGMA foreign_keys = ON");
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      await initializeRequest(env);
    } catch (error) {
      console.error("D1 initialization failed:", error instanceof Error ? error.message : String(error));
      return new Response("Database unavailable", { status: 500 });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    if (request.method === "POST" && url.pathname === "/telegram") {
      if (request.headers.get("x-telegram-bot-api-secret-token") !== runtimeSecrets.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      const updatePayload = await request.clone().json().catch(() => null) as { update_id?: unknown } | null;
      if (updatePayload && typeof updatePayload.update_id === "number" && Number.isSafeInteger(updatePayload.update_id)) {
        try {
          const claimed = await claimWebhookUpdate(updatePayload.update_id);
          if (!claimed) return new Response("ok", { status: 200 });
        } catch (error) {
          // Deduplication is best-effort: never acknowledge and silently discard a
          // callback/message update just because the deduplication table is out of sync.
          console.error(
            "Telegram webhook deduplication failed; processing update without deduplication:",
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      const bot = getBot();
      await ensureBotCommands(bot);
      try {
        const response = await webhookCallback(bot, "cloudflare-mod")(request);
        if (response.status >= 500) {
          console.error("Telegram webhook returned an internal error.");
          return new Response("ok", { status: 200 });
        }
        return response;
      } catch (error) {
        console.error("Telegram update processing failed:", error instanceof Error ? error.message : String(error));
        return new Response("ok", { status: 200 });
      }
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        await initializeRequest(env);
        await dispatchReminders();
      } catch (error) {
        console.error("Scheduled reminder dispatch failed:", error instanceof Error ? error.message : String(error));
      }
    })());
  },
};
