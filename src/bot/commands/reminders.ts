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
import { parseLocalDateTime, formatLocalDateTime, DEFAULT_TIMEZONE, isValidTimezone } from "@/lib/time";
import {
  remindersMenuKeyboard,
  remindersListKeyboard,
  remindersDeleteSelectionKeyboard,
  cancelKeyboard,
  confirmDeleteKeyboard,
} from "@/bot/keyboards";

export const remindersComposer = new Composer();

remindersComposer.command("reminders", async (ctx) => {
  await ctx.reply("⏰ Напоминания:", { reply_markup: remindersMenuKeyboard });
});

remindersComposer.callbackQuery("menu:reminders", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("⏰ Напоминания:", { reply_markup: remindersMenuKeyboard });
});

remindersComposer.command("settimezone", async (ctx) => {
  const tz = ctx.match?.toString().trim();
  if (!tz) {
    await ctx.reply(
      "Использование: /settimezone <IANA-название зоны>\nНапример: /settimezone Europe/Amsterdam"
    );
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
    await ctx.editMessageText(
      "Сначала укажите ваш часовой пояс:\n/settimezone Europe/Amsterdam\n\nПотом снова нажмите ➕ Новое напоминание."
    );
    return;
  }

  await setSessionStep(user.id, SessionStep.REMINDER_AWAITING_TEXT);
  await ctx.editMessageText("Введите текст напоминания:", { reply_markup: cancelKeyboard });
});

remindersComposer.callbackQuery("reminders:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const reminders = await listReminders(user.id);

  if (reminders.length === 0) {
    await ctx.editMessageText("У вас пока нет активных напоминаний.", {
      reply_markup: remindersMenuKeyboard,
    });
    return;
  }

  const lines = reminders
    .map((r) => `#${r.id} — ${formatLocalDateTime(r.dueAt, user.timezone)} — ${r.text}`)
    .join("\n");

  await ctx.editMessageText(`📋 Ваши напоминания:\n\n${lines}\n\nВыберите действие:`, {
    reply_markup: remindersListKeyboard,
  });
});

remindersComposer.callbackQuery("reminders:delete_mode", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const reminders = await listReminders(user.id);

  if (reminders.length === 0) {
    await ctx.editMessageText("У вас пока нет активных напоминаний.", {
      reply_markup: remindersMenuKeyboard,
    });
    return;
  }

  const lines = reminders
    .map((reminder) => `#${reminder.id} — ${formatLocalDateTime(reminder.dueAt, user.timezone)} — ${reminder.text}`)
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
    await ctx.editMessageText("Напоминание не найдено или уже удалено/отправлено.", {
      reply_markup: remindersMenuKeyboard,
    });
    return;
  }

  await ctx.editMessageText(`Удалить напоминание #${id}?`, {
    reply_markup: confirmDeleteKeyboard("reminder", id),
  });
});

remindersComposer.command("cancelreminder", async (ctx) => {
  const arg = ctx.match?.toString().trim();
  const id = Number(arg);
  if (!arg || Number.isNaN(id)) {
    await ctx.reply("Использование: /cancelreminder <номер>");
    return;
  }

  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  const deleted = await deleteReminder(user.id, id);
  await ctx.reply(deleted ? "🗑 Напоминание удалено." : "Напоминание не найдено.", {
    reply_markup: remindersMenuKeyboard,
  });
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
      if (err instanceof ValidationError) {
        await ctx.reply(`⚠️ ${err.message}\nПопробуйте ещё раз:`, { reply_markup: cancelKeyboard });
      } else {
        throw err;
      }
    }
    return true;
  }

  if (session.step === SessionStep.REMINDER_AWAITING_DATETIME) {
    const draft = (session.draft as { text?: string } | null) ?? {};
    if (!draft.text) {
      await clearSession(userId);
      await ctx.reply("Что-то пошло не так, начните заново через /reminders.");
      return true;
    }

    try {
      const user = await getOrCreateUser(BigInt(ctx.from!.id));
      const dueAt = parseLocalDateTime(text.trim(), user.timezone);
      if (!dueAt) {
        throw new ValidationError("Неверный формат даты и времени. Используйте DD.MM.YYYY HH:mm.");
      }
      const reminder = await createReminder(userId, draft.text, dueAt);
      await clearSession(userId);
      await ctx.reply(
        `✅ Напоминание #${reminder.id} создано на ${formatLocalDateTime(reminder.dueAt, user.timezone)}.`,
        { reply_markup: remindersMenuKeyboard }
      );
    } catch (err) {
      if (err instanceof ValidationError) {
        await ctx.reply(`⚠️ ${err.message}\nВведите другую дату и время:`, {
          reply_markup: cancelKeyboard,
        });
      } else {
        throw err;
      }
    }
    return true;
  }

  return false;
}
