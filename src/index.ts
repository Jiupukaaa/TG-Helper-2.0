import { Bot, webhookCallback } from "grammy";
import { registerHandlers } from "@/bot/commands";
import { env as runtimeSecrets, setRuntimeEnv, type RuntimeEnv } from "@/lib/env";
import { setDB } from "@/db/client";
import { claimDueReminders, markReminderFailed, markReminderSent } from "@/services/remindersService";
import { cleanupPastShifts } from "@/services/shiftsService";
import { formatLocalDateTime } from "@/lib/time";

type Env = RuntimeEnv;

let botInstance: Bot | undefined;
let commandSetupAttempted = false;

function getBot(): Bot {
  if (botInstance) return botInstance;
  const bot = new Bot(runtimeSecrets.TELEGRAM_BOT_TOKEN);
  registerHandlers(bot);
  botInstance = bot;
  return bot;
}

async function ensureBotCommands(bot: Bot): Promise<void> {
  if (commandSetupAttempted) return;
  commandSetupAttempted = true;
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Запустить бота" },
      { command: "notes", description: "Открыть заметки" },
      { command: "note", description: "Открыть заметку по номеру" },
      { command: "reminders", description: "Открыть напоминания" },
      { command: "settimezone", description: "Установить часовой пояс" },
      { command: "cancelreminder", description: "Удалить напоминание по номеру" },
    ]);
    await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
  } catch {
    // A Telegram API configuration error must not make the webhook unavailable.
    console.error("Telegram bot menu configuration failed.");
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
        await bot.api.sendMessage(chatId, `⏰ Напоминание (${localTime}):\n${reminder.text}`);
      }
      await markReminderSent(reminder.id);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await markReminderFailed(reminder.id, message, isPermanentTelegramError(error));
      failed += 1;
      console.error("Reminder delivery failed for reminder", reminder.id);
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
    } catch {
      console.error("D1 initialization failed.");
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
      const bot = getBot();
      await ensureBotCommands(bot);
      try {
        return await webhookCallback(bot, "cloudflare-mod")(request);
      } catch {
        // Avoid Telegram retry storms for application errors; details and message content are not logged.
        console.error("Telegram update processing failed.");
        return new Response("ok", { status: 200 });
      }
    }

    if (request.method === "POST" && url.pathname === "/internal/run-reminders") {
      if (request.headers.get("authorization") !== `Bearer ${runtimeSecrets.CRON_SECRET}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      try {
        const result = await dispatchReminders();
        return Response.json({ ok: true, ...result });
      } catch {
        console.error("Manual reminder dispatch failed.");
        return Response.json({ ok: false }, { status: 500 });
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
      } catch {
        console.error("Scheduled reminder dispatch failed.");
      }
    })());
  },
};
