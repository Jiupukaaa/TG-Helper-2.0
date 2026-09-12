import type { Context, NextFunction } from "grammy";
import { isAllowedTelegramId } from "@/lib/env";

/**
 * Rejects any update from a Telegram user not present in ALLOWED_TELEGRAM_IDS.
 * This is a personal bot, not a public service — an unrecognized user gets a
 * short, generic denial and nothing else runs for that update.
 */
export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const fromId = ctx.from?.id;

  if (fromId === undefined) {
    // Update with no identifiable sender (e.g. channel post) — ignore silently.
    return;
  }

  if (!isAllowedTelegramId(BigInt(fromId))) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Доступ запрещён.", show_alert: true });
    } else {
      await ctx.reply("⛔ Доступ запрещён. Этот бот личный.");
    }
    return;
  }

  await next();
}
