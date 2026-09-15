import { Bot } from "grammy";
import { SessionStep } from "@prisma/client";
import { authMiddleware } from "@/bot/middleware/auth";
import { getOrCreateUser, clearSession, getSession, setSessionStep } from "@/bot/session";
import { mainMenuKeyboard, voiceNoteSavedKeyboard, notesMenuKeyboard, cancelKeyboard } from "@/bot/keyboards";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { createNote, createVoiceNote, getOwnedNote, listNotes, replaceVoiceNote } from "@/services/notesService";
import { notesComposer, handleNotesTextInput, handleNotesVoiceInput } from "./notes";
import { remindersComposer, handleReminderTextInput, handleReminderVoiceInput } from "./reminders";
import { shiftsComposer, handleShiftTextInput } from "./shifts";
import { savedComposer, handleSavedTextInput, handleSavedPhotoInput, handleSavedGifInput } from "./saved";

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
        "Дальше используйте меню ниже или команды /notes, /reminders, /shifts и /saved.",
      { reply_markup: mainMenuKeyboard }
    );
  });

  bot.callbackQuery("menu:main", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Главное меню:", { reply_markup: mainMenuKeyboard });
  });

  bot.callbackQuery(/^notes:voice_replace:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const noteId = Number(ctx.match[1]);
    const user = await getOrCreateUser(BigInt(ctx.from.id));
    const note = await getOwnedNote(user.id, noteId);
    if (!note?.voiceFileId) {
      await ctx.editMessageText("Голосовая заметка не найдена.");
      return;
    }
    await setSessionStep(user.id, SessionStep.NOTE_VOICE_REPLACE_AWAITING, { noteId });
    await ctx.editMessageText("🎙️ Отправьте новое голосовое сообщение. Оно заменит текущее голосовое в этой заметке.", {
      reply_markup: cancelKeyboard,
    });
  });

  bot.use(savedComposer);
  bot.use(notesComposer);
  bot.use(remindersComposer);
  bot.use(shiftsComposer);

  bot.on("message:text", async (ctx) => {
    const user = await getOrCreateUser(BigInt(ctx.from!.id));
    if (await handleNotesTextInput(ctx, user.id)) return;
    if (await handleReminderTextInput(ctx, user.id)) return;
    if (await handleShiftTextInput(ctx, user.id)) return;
    if (await handleSavedTextInput(ctx, user.id)) return;

    const text = ctx.message.text;
    try {
      const note = await createNote(user.id, text);
      const notes = await listNotes(user.id);
      const noteNumber = notes.findIndex((item) => item.id === note.id) + 1;
      await ctx.reply(`✅ Заметка #${noteNumber} сохранена.`, { reply_markup: notesMenuKeyboard });
    } catch (err) {
      await ctx.reply("⚠️ Не удалось сохранить заметку. Попробуйте ещё раз.");
    }
  });

  bot.on("message:photo", async (ctx) => {
    const user = await getOrCreateUser(BigInt(ctx.from!.id));
    if (await handleSavedPhotoInput(ctx, user.id)) return;
  });

  bot.on("message:animation", async (ctx) => {
    const user = await getOrCreateUser(BigInt(ctx.from!.id));
    if (await handleSavedGifInput(ctx, user.id)) return;
  });

  bot.on("message:voice", async (ctx) => {
    const user = await getOrCreateUser(BigInt(ctx.from!.id));
    if (await handleNotesVoiceInput(ctx, user.id)) return;
    if (await handleReminderVoiceInput(ctx, user.id)) return;

    const session = await getSession(user.id);

    if (session?.step === SessionStep.NOTE_VOICE_REPLACE_AWAITING) {
      const draft = (session.draft as { noteId?: number } | null) ?? {};
      const noteId = draft.noteId;
      if (!noteId) {
        await clearSession(user.id);
        await ctx.reply("Что-то пошло не так, начните заново через /notes.");
        return;
      }

      const updated = await replaceVoiceNote(user.id, noteId, ctx.message.voice.file_id);
      await clearSession(user.id);
      if (!updated) {
        await ctx.reply("Голосовая заметка не найдена.");
        return;
      }

      const notes = await listNotes(user.id);
      const noteNumber = notes.findIndex((item) => item.id === updated.id) + 1;
      await ctx.reply(`📝 Заметка #${noteNumber}\n\n🎙️ Голосовое сообщение заменено.`, {
        reply_markup: voiceNoteSavedKeyboard(updated.id),
      });
      return;
    }

    if (session && session.step !== "IDLE") {
      await ctx.reply("Сейчас бот ожидает другой тип сообщения. Завершите текущий сценарий или отмените его.");
      return;
    }

    const voiceFileId = ctx.message.voice.file_id;
    const note = await createVoiceNote(user.id, voiceFileId);
    const notes = await listNotes(user.id);
    const noteNumber = notes.findIndex((item) => item.id === note.id) + 1;
    await ctx.reply(`📝 Заметка #${noteNumber}\n\n🎙️ Голосовое сообщение`, {
      reply_markup: voiceNoteSavedKeyboard(note.id),
    });
  });

  bot.on("message", async (ctx, next) => {
    if (ctx.message.text?.startsWith("/")) {
      const user = await getOrCreateUser(BigInt(ctx.from!.id));
      await clearSession(user.id);
      await ctx.reply("Неизвестная команда. Используйте /notes, /reminders, /shifts или /saved.");
      return;
    }
    await next();
  });

  bot.catch((err) => {
    console.error("Bot error:", err.message);
  });
}
