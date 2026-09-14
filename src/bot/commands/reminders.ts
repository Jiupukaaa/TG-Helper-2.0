import { Composer } from "grammy";
import { SessionStep } from "@prisma/client";
import { getOrCreateUser, setSessionStep, clearSession, getSession } from "@/bot/session";
import {
  createReminder,
  listReminders,
  deleteReminder,
  getOwnedReminder,
  ValidationError,
} from "@/services/remindersService";
import { VOICE_NOTE_TEXT } from "@/services/notesService";
import { parseLocalDateTime, formatLocalDateTime, DEFAULT_TIMEZONE, isValidTimezone } from "@/lib/time";
import {
  remindersMenuKeyboard,
  remindersListKeyboard,
  remindersDeleteSelectionKeyboard,
  cancelKeyboard,
  confirmDeleteKeyboard,
} from "@/bot/keyboards";

export const remindersComposer = new Composer();

function getReminderNumber(reminders: Array<{ id: number }>, reminderId: number): number | null {
  const index = reminders.findIndex((reminder) => reminder.id === reminderId);
  return index === -1 ? null : index + 1;
}

async function showRemindersList(ctx: any, userId: number, timezone: string, mode: "reply" | "edit") {
  const reminders = await listReminders(userId);
  const text = reminders.length === 0
    ? "⏰ У вас пока нет активных напоминаний. Добавьте первое напоминание:"
    : `📋 Ваши напоминания:\n\n${reminders
        .map((reminder, index) => `#${index + 1} — ${formatLocalDateTime(reminder.dueAt, timezone)} — ${reminder.voiceFileId ? "🎙️ Голосовое сообщение" : reminder.text}`)
        .join("\n")}\n\nВыберите действие:`;

  if (mode === "reply") await ctx.reply(text, { reply_markup: remindersListKeyboard });
  else await ctx.editMessageText(text, { reply_markup: remindersListKeyboard });
}

remindersComposer.command("reminders", async (ctx) => {
  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  await showRemindersList(ctx, user.id, user.timezone, "reply");
});

remindersComposer.callbackQuery("menu:reminders", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await showRemindersList(ctx, user.id, user.timezone, "edit");
});

remindersComposer.command("settimezone", async (ctx) => {
  const tz = ctx.match?.toString().trim();
  if (!tz) {
    await ctx.reply("Использование: /settimezone <IANA-название зоны>\nНапример: /settimezone Europe/Amsterdam");
    return;
  }
  if (!isValidTimezone(tz)) {
    await ctx.reply("⚠️ Не удалось распознать часовой пояс. Проверьте название, например: Europe/Amsterdam, Asia/Yerevan.");
    return;
  }
  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  const { prisma } = await import("@/lib/prisma");
  await prisma.user.update({ where: { id: user.id }, data: { timezone: tz } });
  await ctx.reply(`✅ Часовой пояс установлен: ${tz}`);
});

remindersComposer.callbackQuery("reminders:new", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));

  if (user.timezone === DEFAULT_TIMEZONE) {
    await ctx.editMessageText("Сначала укажите ваш часовой пояс:\n/settimezone Europe/Amsterdam\n\nПотом снова нажмите ➕ Новое напоминание.");
    return;
  }

  await setSessionStep(user.id, SessionStep.REMINDER_AWAITING_TEXT);
  await ctx.editMessageText("Введите текст напоминания или отправьте голосовое сообщение:", { reply_markup: cancelKeyboard });
});

remindersComposer.callbackQuery("reminders:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await showRemindersList(ctx, user.id, user.timezone, "edit");
});

remindersComposer.callbackQuery("reminders:delete_mode", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const reminders = await listReminders(user.id);

  if (reminders.length === 0) {
    await ctx.editMessageText("⏰ У вас пока нет активных напоминаний. Добавьте первое напоминание:", { reply_markup: remindersListKeyboard });
    return;
  }

  const lines = reminders
    .map((reminder, index) => `#${index + 1} — ${formatLocalDateTime(reminder.dueAt, user.timezone)} — ${reminder.voiceFileId ? "🎙️ Голосовое сообщение" : reminder.text}`)
    .join("\n");

  await ctx.editMessageText(`🗑 Выберите номер напоминания для удаления:\n\n${lines}`, {
    reply_markup: remindersDeleteSelectionKeyboard(reminders.map((reminder) => reminder.id)),
  });
});

remindersComposer.callbackQuery(/^reminders:delete_select:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const reminder = await getOwnedReminder(user.id, id);

  if (!reminder) {
    await ctx.editMessageText("Напоминание не найдено или уже удалено/отправлено.", { reply_markup: remindersMenuKeyboard });
    return;
  }

  const reminders = await listReminders(user.id);
  const reminderNumber = getReminderNumber(reminders, id);
  if (reminderNumber === null) {
    await ctx.editMessageText("Напоминание не найдено или уже удалено/отправлено.", { reply_markup: remindersMenuKeyboard });
    return;
  }

  await ctx.editMessageText(`Удалить напоминание #${reminderNumber}?`, { reply_markup: confirmDeleteKeyboard("reminder", id) });
});

remindersComposer.command("cancelreminder", async (ctx) => {
  const arg = ctx.match?.toString().trim();
  const reminderNumber = Number(arg);
  if (!arg || Number.isNaN(reminderNumber) || !Number.isInteger(reminderNumber) || reminderNumber < 1) {
    await ctx.reply("Использование: /cancelreminder <номер>");
    return;
  }

  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  const reminders = await listReminders(user.id);
  const reminder = reminders[reminderNumber - 1];
  if (!reminder) {
    await ctx.reply("Напоминание не найдено.", { reply_markup: remindersMenuKeyboard });
    return;
  }

  const deleted = await deleteReminder(user.id, reminder.id);
  await ctx.reply(deleted ? "🗑 Напоминание удалено." : "Напоминание не найдено.", { reply_markup: remindersMenuKeyboard });
});

remindersComposer.callbackQuery(/^reminders:delete_confirm:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const deleted = await deleteReminder(user.id, id);
  if (!deleted) {
    await ctx.editMessageText("Напоминание не найдено или уже удалено/отправлено.");
    return;
  }
  await ctx.editMessageText("🗑 Напоминание удалено.", { reply_markup: remindersMenuKeyboard });
});

remindersComposer.callbackQuery("session:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await clearSession(user.id);
  await ctx.editMessageText("Отменено.", { reply_markup: remindersMenuKeyboard });
});

export async function handleReminderTextInput(ctx: any, userId: number): Promise<boolean> {
  const session = await getSession(userId);
  if (!session) return false;

  const text = ctx.message?.text as string | undefined;
  if (!text) return false;

  if (session.step === SessionStep.REMINDER_AWAITING_TEXT) {
    try {
      const trimmed = text.trim();
      if (!trimmed) throw new ValidationError("Текст напоминания не может быть пустым.");
      if (trimmed.length > 1000) throw new ValidationError("Слишком длинный текст (максимум 1000 символов).");
      await setSessionStep(userId, SessionStep.REMINDER_AWAITING_DATETIME, { text: trimmed });
      await ctx.reply("Введите дату и время в формате DD.MM.YYYY HH:mm:", { reply_markup: cancelKeyboard });
    } catch (err) {
      if (err instanceof ValidationError) await ctx.reply(`⚠️ ${err.message}\nПопробуйте ещё раз:`, { reply_markup: cancelKeyboard });
      else throw err;
    }
    return true;
  }

  if (session.step === SessionStep.REMINDER_AWAITING_DATETIME) {
    const draft = (session.draft as { text?: string; voiceFileId?: string } | null) ?? {};
    if (!draft.text) {
      await clearSession(userId);
      await ctx.reply("Что-то пошло не так, начните заново через /reminders.");
      return true;
    }

    try {
      const user = await getOrCreateUser(BigInt(ctx.from!.id));
      const dueAt = parseLocalDateTime(text.trim(), user.timezone);
      if (!dueAt) throw new ValidationError("Неверный формат даты и времени. Используйте DD.MM.YYYY HH:mm.");
      const reminder = await createReminder(userId, draft.text, dueAt, draft.voiceFileId);
      const reminders = await listReminders(userId);
      const reminderNumber = getReminderNumber(reminders, reminder.id) ?? 1;
      await clearSession(userId);
      await ctx.reply(`✅ Напоминание #${reminderNumber} создано на ${formatLocalDateTime(reminder.dueAt, user.timezone)}.`, { reply_markup: remindersMenuKeyboard });
    } catch (err) {
      if (err instanceof ValidationError) await ctx.reply(`⚠️ ${err.message}\nВведите другую дату и время:`, { reply_markup: cancelKeyboard });
      else throw err;
    }
    return true;
  }

  return false;
}

export async function handleReminderVoiceInput(ctx: any, userId: number): Promise<boolean> {
  const session = await getSession(userId);
  if (!session || session.step !== SessionStep.REMINDER_AWAITING_TEXT) return false;

  const voiceFileId = ctx.message?.voice?.file_id as string | undefined;
  if (!voiceFileId) return false;

  await setSessionStep(userId, SessionStep.REMINDER_AWAITING_DATETIME, {
    text: VOICE_NOTE_TEXT,
    voiceFileId,
  });
  await ctx.reply("🎙️ Голосовое сохранено. Теперь введите дату и время в формате DD.MM.YYYY HH:mm:", { reply_markup: cancelKeyboard });
  return true;
}
