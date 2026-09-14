import { Bot } from "grammy";
import { authMiddleware } from "@/bot/middleware/auth";
import { getOrCreateUser, clearSession } from "@/bot/session";
import { mainMenuKeyboard } from "@/bot/keyboards";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { notesComposer, handleNotesTextInput } from "./notes";
import { remindersComposer, handleReminderTextInput } from "./reminders";

export function registerHandlers(bot: Bot): void {
  bot.use(authMiddleware);

  bot.command("start", async (ctx) => {
    const user = await getOrCreateUser(BigInt(ctx.from!.id));
    const timezoneMessage =
      user.timezone === DEFAULT_TIMEZONE
        ? "Сначала укажите часовой пояс:\n/settimezone Europe/Amsterdam\n\n"
        : `Часовой пояс: ${user.timezone}\n\n`;

    await ctx.reply(
      "👋 Привет! Я TG Helper — личный помощник для заметок и напоминаний.\n\n" +
        timezoneMessage +
        "Дальше используйте меню ниже или команды /notes и /reminders.",
      { reply_markup: mainMenuKeyboard }
    );
  });

  bot.callbackQuery("menu:main", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Главное меню:", { reply_markup: mainMenuKeyboard });
  });

  bot.use(notesComposer);
  bot.use(remindersComposer);

  // Any plain text message: first check whether the user is mid-session
  // (creating/editing a note or reminder). If a new top-level command
  // arrives while a session is active, the composer's `command()` handlers
  // above already matched it and this handler won't run for that update —
  // but if the user types free text that looks like an accidental new
  // command while a session is active, we still prioritize the session.
  bot.on("message:text", async (ctx) => {
    const user = await getOrCreateUser(BigInt(ctx.from!.id));

    const consumedByNotes = await handleNotesTextInput(ctx, user.id);
    if (consumedByNotes) return;

    const consumedByReminders = await handleReminderTextInput(ctx, user.id);
    if (consumedByReminders) return;

    await ctx.reply("Не понимаю это сообщение. Используйте /notes или /reminders.");
  });

  // Fallback for any command that isn't recognized above.
  bot.on("message", async (ctx, next) => {
    if (ctx.message.text?.startsWith("/")) {
      const user = await getOrCreateUser(BigInt(ctx.from!.id));
      await clearSession(user.id); // an unrecognized command breaks out of any active session
      await ctx.reply("Неизвестная команда. Используйте /notes или /reminders.");
      return;
    }
    await next();
  });

  bot.catch((err) => {
    // Never log tokens/secrets — grammy's BotError does not include them,
    // but avoid dumping raw update objects that might contain user text.
    console.error("Bot error:", err.message);
  });
}
