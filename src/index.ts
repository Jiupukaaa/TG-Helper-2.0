import { Bot, webhookCallback } from "grammy";
import { registerHandlers } from "@/bot/commands";
import { env as runtimeSecrets, setRuntimeEnv, type RuntimeEnv } from "@/lib/env";
import { setDB } from "@/db/client";
import { claimDueReminders, markReminderFailed, markReminderSent } from "@/services/remindersService";
import { cleanupPastShifts } from "@/services/shiftsService";
import { claimWebhookUpdate, completeWebhookUpdate, releaseWebhookUpdate } from "@/services/webhookDedupService";
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
    // Remove the legacy Telegram command list and restore the default chat menu button.
    await bot.api.setMyCommands([]);
    await bot.api.setChatMenuButton({ menu_button: { type: "default" } });
  } catch {
    // A Telegram API configuration error must not make the webhook unavailable.
    console.error("Telegram bot menu configuration failed.");
  }
}

function isPermanentTelegramError(error: unknown): boolean {
  let value = error as { description?: string; error_code?: number; error?: unknown } | null;
  for (let depth = 0; depth < 3 && value?.error && typeof value.error === "object"; depth += 1) {
    value = value.error as { description?: string; error_code?: number; error?: unknown };
  }
  if (value?.error_code === 400 || value?.error_code === 403) return true;
  const description = value?.description ?? "";
  return /chat not found|user is deactivated/i.test(description);
}

function isWebhookTimeout(error: unknown): boolean {
  return error instanceof Error && /Request timed out after \d+ ms/.test(error.message);
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

      const updatePayload = await request.clone().json().catch(() => null) as { update_id?: unknown } | null;
      const updateId = updatePayload && typeof updatePayload.update_id === "number" &&
        Number.isSafeInteger(updatePayload.update_id) && updatePayload.update_id >= 0
        ? updatePayload.update_id
        : undefined;
      let claimToken: string | undefined;

      if (updateId !== undefined) {
        try {
          const claim = await claimWebhookUpdate(updateId);
          if (claim.status === "PROCESSED") return new Response("ok", { status: 200 });
          if (claim.status === "BUSY") {
            return new Response("Update is already being processed", {
              status: 503,
              headers: { "retry-after": "2" },
            });
          }
          claimToken = claim.token;
        } catch {
          console.error("Telegram webhook deduplication failed.");
          return new Response("Database unavailable", { status: 500 });
        }
      }

      try {
        const bot = getBot();
        await ensureBotCommands(bot);
        const response = await webhookCallback(bot, "cloudflare-mod")(request);

        if (!response.ok) {
          if (updateId !== undefined && claimToken) await releaseWebhookUpdate(updateId, claimToken);
          console.error("Telegram webhook returned an unsuccessful response.");
          return new Response("Telegram update processing failed", { status: 500 });
        }

        if (updateId !== undefined && claimToken) {
          await completeWebhookUpdate(updateId, claimToken);
        }
        return response;
      } catch (error) {
        if (updateId !== undefined && claimToken) {
          if (isPermanentTelegramError(error)) {
            try {
              await completeWebhookUpdate(updateId, claimToken);
            } catch {
              console.error("Could not finalize a permanently rejected Telegram update.");
              return new Response("Database unavailable", { status: 500 });
            }
            console.error("Telegram update was rejected by Telegram permanently.");
            return new Response("ok", { status: 200 });
          }

          // A timed-out handler may still be running. Keep its lease to avoid starting
          // a concurrent retry; the lease expires automatically if the Worker died.
          if (!isWebhookTimeout(error)) {
            try {
              await releaseWebhookUpdate(updateId, claimToken);
            } catch {
              console.error("Could not release a failed Telegram update.");
            }
          }
        }
        console.error("Telegram update processing failed.");
        return new Response("Telegram update processing failed", { status: 500 });
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
