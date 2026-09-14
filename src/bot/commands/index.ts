import { Bot } from "grammy";
import { authMiddleware } from "@/bot/middleware/auth";
import { getOrCreateUser, clearSession } from "@/bot/session";
import { mainMenuKeyboard } from "@/bot/keyboards";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { notesComposer, handleNotesTextInput } from "./notes";
import { remindersComposer, handleReminderTextInput } from "./reminders";
import { shiftsComposer, handleShiftTextInput } from "./shifts";

export function registerHandlers(bot: Bot): void {
  bot.use(authMiddleware);

  bot.command("start", async (ctx) => {
    const user = await getOrCreateUser(BigInt(ctx.from!.id));
    const timezoneMessage = user.timezone === DEFAULT_TIMEZONE
      ? "Сначала укажите часовой пояс:\n/settimezone Europe/Amsterdam\n\n"
      : `Часовой пояс: ${user.timezone}\n\n`;
    await ctx.reply(
      "👋 Привет! Я TG Helper — личный помощник для заметок, напоминаний и графика работы.\n\n" +
        timezoneMessage +
        "Дальше используйте меню ниже или команды /notes, /reminders и /shifts.",
      { reply_markup: mainMenuKeyboard }
    );
  });

  bot.callbackQuery("menu:main", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Главное меню:", { reply_markup: mainMenuKeyboard });
  });

  bot.use(notesComposer);
  bot.use(remindersComposer);
  bot.use(shiftsComposer);

  bot.on("message:text", async (ctx) => {
    const user = await getOrCreateUser(BigInt(ctx.from!.id));
    if (await handleNotesTextInput(ctx, user.id)) return;
    if (await handleReminderTextInput(ctx, user.id)) return;
    if (await handleShiftTextInput(ctx, user.id)) return;
    await ctx.reply("Не понимаю это сообщение. Используйте меню или /notes, /reminders, /shifts.");
  });

  bot.on("message", async (ctx, next) => {
    if (ctx.message.text?.startsWith("/")) {
      const user = await getOrCreateUser(BigInt(ctx.from!.id));
      await clearSession(user.id);
      await ctx.reply("Неизвестная команда. Используйте /notes, /reminders или /shifts.");
      return;
    }
    await next();
  });

  bot.catch((err) => {
    console.error("Bot error:", err.message);
  });
}
