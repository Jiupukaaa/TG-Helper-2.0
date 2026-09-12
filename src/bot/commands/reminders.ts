import { Composer } from "grammy";
import { SessionStep } from "@prisma/client";
import { getOrCreateUser, setSessionStep, clearSession, getSession } from "@/bot/session";
import {
  createReminder,
  listReminders,
  deleteReminder,
  ValidationError,
} from "@/services/remindersService";
import { parseLocalDateTime, formatLocalDateTime, DEFAULT_TIMEZONE, isValidTimezone } from "@/lib/time";
import {
  remindersMenuKeyboard,
  reminderItemKeyboard,
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

  await ctx.editMessageText(
    `📋 Ваши напоминания:\n\n${lines}\n\nОтправьте /cancelreminder <номер> чтобы удалить.`,
    { reply_markup: remindersMenuKeyboard }
  );
});

remindersComposer.command("cancelreminder", async (ctx) => {
  const arg = ctx.match?.toString().trim();
  const id = Number(arg);
  if (!arg || Number.isNaN(id)) {
    await ctx.reply("Использование: /cancelreminder <номер>");
    return;
  }
  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  await ctx.reply(`Удалить напоминание #${id}?`, {
    reply_markup: confirmDeleteKeyboard("reminder", id),
  });
});

remindersComposer.callbackQuery(/^reminders:delete:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  await ctx.editMessageText(`Удалить напоминание #${id}?`, {
    reply_markup: confirmDeleteKeyboard("reminder", id),
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

/**
 * Handles free-text input while the user is in a reminder-related session
 * step (text -> datetime). Returns true if it consumed the message.
 *
 * Validation order, each with its own retry-in-place behaviour:
 *   1. text non-empty / not too long
 *   2. datetime format "DD.MM.YYYY HH:mm"
 *   3. datetime not in the past (checked in the user's own timezone)
 */
export async function handleReminderTextInput(ctx: any, userId: number): Promise<boolean> {
  const session = await getSession(userId);
  if (!session) return false;

  const text = ctx.message?.text as string | undefined;
  if (!text) return false;

  if (session.step === SessionStep.REMINDER_AWAITING_TEXT) {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 1000) {
      await ctx.reply("⚠️ Текст должен быть от 1 до 1000 символов. Попробуйте ещё раз:", {
        reply_markup: cancelKeyboard,
      });
      return true;
    }
    await setSessionStep(userId, SessionStep.REMINDER_AWAITING_DATETIME, { text: trimmed });
    await ctx.reply(
      "Когда напомнить? Введите дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ\nНапример: 25.12.2026 09:00",
      { reply_markup: cancelKeyboard }
    );
    return true;
  }

  if (session.step === SessionStep.REMINDER_AWAITING_DATETIME) {
    const draft = (session.draft as { text?: string } | null) ?? {};
    const reminderText = draft.text;
    if (!reminderText) {
      await clearSession(userId);
      await ctx.reply("Что-то пошло не так, начните заново через /reminders.");
      return true;
    }

    const { prisma } = await import("@/lib/prisma");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const timezone = user?.timezone ?? DEFAULT_TIMEZONE;

    const parsed = parseLocalDateTime(text, timezone);
    if (!parsed) {
      await ctx.reply(
        "⚠️ Не удалось распознать дату. Формат: ДД.ММ.ГГГГ ЧЧ:ММ, например: 25.12.2026 09:00\nПопробуйте ещё раз:",
        { reply_markup: cancelKeyboard }
      );
      return true;
    }

    try {
      const reminder = await createReminder(userId, reminderText, parsed);
      await clearSession(userId);
      await ctx.reply(
        `✅ Напоминание #${reminder.id} создано на ${formatLocalDateTime(reminder.dueAt, timezone)} (${timezone}).`,
        { reply_markup: remindersMenuKeyboard }
      );
    } catch (err) {
      if (err instanceof ValidationError) {
        // Covers "date is in the past" — same step, same draft, ask again.
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
