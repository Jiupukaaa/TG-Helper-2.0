import { Bot } from "grammy";
import { authMiddleware } from "@/bot/middleware/auth";
import { getOrCreateUser, clearSession, getSession } from "@/bot/session";
import { mainMenuKeyboard } from "@/bot/keyboards";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { createVoiceNote, listNotes } from "@/services/notesService";
import { notesComposer, handleNotesTextInput, handleNotesVoiceInput } from "./notes";
import { remindersComposer, handleReminderTextInput, handleReminderVoiceInput } from "./reminders";
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

  bot.on("message:voice", async (ctx) => {
    const user = await getOrCreateUser(BigInt(ctx.from!.id));
    if (await handleNotesVoiceInput(ctx, user.id)) return;
    if (await handleReminderVoiceInput(ctx, user.id)) return;

    const session = await getSession(user.id);
    if (session && session.step !== "IDLE") {
      await ctx.reply("Сейчас бот ожидает другой тип сообщения. Завершите текущий сценарий или отмените его.");
      return;
    }

    const voiceFileId = ctx.message.voice.file_id;
    const note = await createVoiceNote(user.id, voiceFileId);
    const notes = await listNotes(user.id);
    const noteNumber = notes.findIndex((item) => item.id === note.id) + 1;
    await ctx.reply(`✅ Голосовая заметка #${noteNumber} сохранена.`);
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
