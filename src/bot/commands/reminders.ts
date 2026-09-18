import { randomUUID } from "node:crypto";
import { Composer, InlineKeyboard } from "grammy";
import { SessionStep } from "@prisma/client";
import { getOrCreateUser, setSessionStep, clearSession, getSession } from "@/bot/session";
import { createReminder, listReminders, deleteReminder, deleteReminderGroup, getReminderGroup, updateReminderGroup, getOwnedReminder, ValidationError } from "@/services/remindersService";
import { VOICE_NOTE_TEXT } from "@/services/notesService";
import { parseLocalDateTime, formatLocalDateTime, DEFAULT_TIMEZONE, isValidTimezone } from "@/lib/time";
import { remindersMenuKeyboard, remindersListKeyboard, remindersDeleteSelectionKeyboard, reminderManageKeyboard, reminderInstanceSelectionKeyboard, reminderEditFieldKeyboard, cancelKeyboard, confirmDeleteKeyboard, mainMenuKeyboard } from "@/bot/keyboards";

export const remindersComposer = new Composer();

type RepeatRule = "daily" | "weekly" | "monthly";
type ReminderDraft = {
  text?: string;
  voiceFileId?: string;
  awaitingRepeatCount?: boolean;
  repeatRule?: RepeatRule;
  dueAt?: string;
  editMode?: "date" | "time" | "text";
  editReminderId?: number;
};

type ReminderListItem = {
  id: number;
  text: string;
  voiceFileId: string | null;
  dueAt: Date;
  repeatGroupId: string | null;
  repeatRule: string | null;
};

function getReminderNumber(reminders: Array<{ id: number }>, reminderId: number): number | null {
  const index = reminders.findIndex((reminder) => reminder.id === reminderId);
  return index === -1 ? null : index + 1;
}

function repeatKeyboard() {
  return new InlineKeyboard()
    .text("Не повторять", "reminders:repeat:none")
    .row().text("Каждый день", "reminders:repeat:daily")
    .row().text("Каждую неделю", "reminders:repeat:weekly")
    .row().text("Каждый месяц", "reminders:repeat:monthly")
    .row().text("❌ Отмена", "session:cancel");
}

function repeatLabel(rule: string | null): string {
  const labels: Record<string, string> = {
    daily: "ежедневно",
    weekly: "еженедельно",
    monthly: "ежемесячно",
  };
  return labels[rule ?? ""] ?? "по расписанию";
}

function formatReminderList(reminders: ReminderListItem[], timezone: string): string {
  if (reminders.length === 0) return "⏰ У вас пока нет активных напоминаний. Добавьте первое напоминание:";

  const lines: string[] = [];
  const processedGroups = new Set<string>();

  reminders.forEach((reminder, index) => {
    if (reminder.repeatGroupId) {
      if (processedGroups.has(reminder.repeatGroupId)) return;
      processedGroups.add(reminder.repeatGroupId);
      const group = reminders.filter((item) => item.repeatGroupId === reminder.repeatGroupId);
      const first = group[0]!;
      const title = first.voiceFileId ? "🎙️ Голосовое сообщение" : first.text;
      lines.push(`🔁 ${title} — ${repeatLabel(first.repeatRule)} ×${group.length}`);
      lines.push(`   Следующее: ${formatLocalDateTime(first.dueAt, timezone)}`);
      return;
    }

    const title = reminder.voiceFileId ? "🎙️ Голосовое сообщение" : reminder.text;
    lines.push(`#${index + 1} — ${formatLocalDateTime(reminder.dueAt, timezone)} — ${title}`);
  });

  return `📋 Ваши напоминания:\n\n${lines.join("\n")}\n\nВыберите действие:`;
}

async function showRemindersList(ctx: any, userId: number, timezone: string, mode: "reply" | "edit") {
  const reminders = await listReminders(userId);
  const text = formatReminderList(reminders, timezone);
  if (mode === "reply") await ctx.reply(text, { reply_markup: remindersListKeyboard });
  else await ctx.editMessageText(text, { reply_markup: remindersListKeyboard });
}

remindersComposer.command("reminders", async (ctx) => { const user = await getOrCreateUser(BigInt(ctx.from!.id)); await showRemindersList(ctx, user.id, user.timezone, "reply"); });
remindersComposer.callbackQuery("menu:reminders", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await showRemindersList(ctx, user.id, user.timezone, "edit"); });

remindersComposer.command("settimezone", async (ctx) => {
  const tz = ctx.match?.toString().trim();
  if (!tz) { await ctx.reply("Использование: /settimezone <IANA-название зоны>\nНапример: /settimezone Europe/Amsterdam"); return; }
  if (!isValidTimezone(tz)) { await ctx.reply("⚠️ Не удалось распознать часовой пояс. Проверьте название, например: Europe/Amsterdam, Asia/Yerevan."); return; }
  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  const { prisma } = await import("@/lib/prisma");
  await prisma.user.update({ where: { id: user.id }, data: { timezone: tz } });
  await ctx.reply(`✅ Часовой пояс установлен: ${tz}`, { reply_markup: mainMenuKeyboard });
});

remindersComposer.callbackQuery("reminders:new", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  if (user.timezone === DEFAULT_TIMEZONE) { await ctx.editMessageText("Сначала укажите ваш часовой пояс:\n/settimezone Europe/Amsterdam\n\nПотом снова нажмите ➕ Новое напоминание."); return; }
  await setSessionStep(user.id, SessionStep.REMINDER_AWAITING_TEXT);
  await ctx.editMessageText("Введите текст напоминания или отправьте голосовое сообщение.\n\n🎙️ Голосовое напоминание можно создать только внутри этого сценария.", { reply_markup: cancelKeyboard });
});

remindersComposer.callbackQuery("reminders:list", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await showRemindersList(ctx, user.id, user.timezone, "edit"); });

remindersComposer.callbackQuery(/^reminders:repeat:(none|daily|weekly|monthly)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const rule = ctx.match[1] as "none" | RepeatRule;
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const session = await getSession(user.id);
  if (!session || session.step !== SessionStep.REMINDER_AWAITING_DATETIME) { await ctx.editMessageText("Сценарий создания напоминания завершён. Начните заново.", { reply_markup: remindersMenuKeyboard }); return; }
  const draft = (session.draft as ReminderDraft | null) ?? {};
  if (!draft.text || !draft.dueAt) { await ctx.editMessageText("Не удалось собрать напоминание. Начните заново.", { reply_markup: remindersMenuKeyboard }); return; }
  if (rule === "none") {
    const reminder = await createReminder(user.id, draft.text, new Date(draft.dueAt), draft.voiceFileId);
    const reminders = await listReminders(user.id); const n = getReminderNumber(reminders, reminder.id) ?? 1;
    await clearSession(user.id); await ctx.editMessageText(`✅ Напоминание #${n} создано на ${formatLocalDateTime(reminder.dueAt, user.timezone)}.`, { reply_markup: remindersMenuKeyboard });
    return;
  }
  await setSessionStep(user.id, SessionStep.REMINDER_AWAITING_DATETIME, { ...draft, awaitingRepeatCount: true, repeatRule: rule });
  const labels: Record<RepeatRule, string> = { daily: "каждый день", weekly: "каждую неделю", monthly: "каждый месяц" };
  await ctx.editMessageText(`🔁 Повторять ${labels[rule]}.\n\nСколько раз создать? Введите число от 2 до 52.`, { reply_markup: cancelKeyboard });
});

remindersComposer.callbackQuery("reminders:delete_mode", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const reminders = await listReminders(user.id);
  if (!reminders.length) {
    await ctx.editMessageText("⏰ У вас пока нет активных напоминаний.", { reply_markup: remindersListKeyboard });
    return;
  }

  const lines: string[] = [];
  const representatives: number[] = [];
  const processedGroups = new Set<string>();

  reminders.forEach((reminder) => {
    if (reminder.repeatGroupId) {
      if (processedGroups.has(reminder.repeatGroupId)) return;
      processedGroups.add(reminder.repeatGroupId);
      const group = reminders.filter((item) => item.repeatGroupId === reminder.repeatGroupId);
      const first = group[0]!;
      representatives.push(first.id);
      const title = first.voiceFileId ? "🎙️ Голосовое сообщение" : first.text;
      lines.push(`🔁 #${representatives.length} — ${title} — ${repeatLabel(first.repeatRule)} ×${group.length}`);
      lines.push(`   Следующее: ${formatLocalDateTime(first.dueAt, user.timezone)}`);
      return;
    }
    representatives.push(reminder.id);
    const title = reminder.voiceFileId ? "🎙️ Голосовое сообщение" : reminder.text;
    lines.push(`#${representatives.length} — ${formatLocalDateTime(reminder.dueAt, user.timezone)} — ${title}`);
  });

  await ctx.editMessageText(
    `🗑 Выберите напоминание:\n\n${lines.join("\n")}\n\nДля повторяющихся напоминаний будет открыто отдельное меню.`,
    { reply_markup: remindersDeleteSelectionKeyboard(representatives) },
  );
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

  const group = await getReminderGroup(user.id, id);
  const first = group[0]!;
  const title = first.voiceFileId ? "🎙️ Голосовое сообщение" : first.text;
  const details = first.repeatGroupId
    ? `🔁 ${title}\n${repeatLabel(first.repeatRule)}\nКоличество будущих срабатываний: ${group.length}\nСледующее: ${formatLocalDateTime(first.dueAt, user.timezone)}`
    : `⏰ ${formatLocalDateTime(first.dueAt, user.timezone)}\n${title}`;

  await ctx.editMessageText(`${details}\n\nВыберите действие:`, { reply_markup: reminderManageKeyboard(id) });
});

remindersComposer.callbackQuery(/^reminders:manage:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const reminder = await getOwnedReminder(user.id, id);
  if (!reminder) {
    await ctx.editMessageText("Напоминание не найдено.", { reply_markup: remindersMenuKeyboard });
    return;
  }
  const group = await getReminderGroup(user.id, id);
  const first = group[0]!;
  const title = first.voiceFileId ? "🎙️ Голосовое сообщение" : first.text;
  await ctx.editMessageText(
    `${first.repeatGroupId ? "🔁" : "⏰"} ${title}\n${first.repeatGroupId ? `${repeatLabel(first.repeatRule)} · ${group.length} срабатываний\nСледующее: ${formatLocalDateTime(first.dueAt, user.timezone)}` : formatLocalDateTime(first.dueAt, user.timezone)}\n\nВыберите действие:`,
    { reply_markup: reminderManageKeyboard(id) },
  );
});

remindersComposer.callbackQuery(/^reminders:delete_all:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const count = await deleteReminderGroup(user.id, Number(ctx.match[1]));
  await ctx.editMessageText(count ? `🗑 Удалено напоминаний: ${count}.` : "Напоминание не найдено.", { reply_markup: remindersMenuKeyboard });
});

remindersComposer.callbackQuery(/^reminders:delete_one_mode:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const group = await getReminderGroup(user.id, Number(ctx.match[1]));
  if (!group.length) {
    await ctx.editMessageText("Напоминание не найдено.", { reply_markup: remindersMenuKeyboard });
    return;
  }
  if (group.length === 1) {
    await ctx.editMessageText("У этого напоминания нет повторов. Можно удалить его полностью.", { reply_markup: reminderManageKeyboard(group[0]!.id) });
    return;
  }
  const lines = group.map((item, index) => `#${index + 1} — ${formatLocalDateTime(item.dueAt, user.timezone)} — ${item.voiceFileId ? "🎙️ Голосовое сообщение" : item.text}`).join("\n");
  await ctx.editMessageText(
    `❌ Выберите одно напоминание для удаления:\n\n${lines}`,
    { reply_markup: reminderInstanceSelectionKeyboard(group.map((item) => item.id)) },
  );
});

remindersComposer.callbackQuery(/^reminders:delete_one:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const reminder = await getOwnedReminder(user.id, Number(ctx.match[1]));
  if (!reminder) {
    await ctx.editMessageText("Напоминание не найдено.", { reply_markup: remindersMenuKeyboard });
    return;
  }
  await ctx.editMessageText(
    `Удалить одно напоминание?\n\n${formatLocalDateTime(reminder.dueAt, user.timezone)}\n${reminder.voiceFileId ? "🎙️ Голосовое сообщение" : reminder.text}`,
    { reply_markup: confirmDeleteKeyboard("reminder", reminder.id) },
  );
});

remindersComposer.callbackQuery(/^reminders:edit_mode:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const reminder = await getOwnedReminder(user.id, id);
  if (!reminder) {
    await ctx.editMessageText("Напоминание не найдено.", { reply_markup: remindersMenuKeyboard });
    return;
  }
  await ctx.editMessageText("✏️ Что именно изменить?", { reply_markup: reminderEditFieldKeyboard(id) });
});

remindersComposer.callbackQuery(/^reminders:edit_field:(date|time|text):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const mode = ctx.match[1] as "date" | "time" | "text";
  const id = Number(ctx.match[2]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const reminder = await getOwnedReminder(user.id, id);
  if (!reminder) {
    await ctx.editMessageText("Напоминание не найдено.", { reply_markup: remindersMenuKeyboard });
    return;
  }
  const prompts = {
    date: "Введите новую дату первой точки серии в формате DD.MM.YYYY:",
    time: "Введите новое время в формате HH:mm:",
    text: "Введите новый текст напоминания:",
  };
  await setSessionStep(user.id, SessionStep.REMINDER_AWAITING_DATETIME, { editMode: mode, editReminderId: id });
  await ctx.editMessageText(prompts[mode], { reply_markup: cancelKeyboard });
});

remindersComposer.command("cancelreminder", async (ctx) => {
  const arg = ctx.match?.toString().trim(); const n = Number(arg);
  if (!arg || Number.isNaN(n) || !Number.isInteger(n) || n < 1) { await ctx.reply("Использование: /cancelreminder <номер>"); return; }
  const user = await getOrCreateUser(BigInt(ctx.from!.id)); const reminders = await listReminders(user.id); const reminder = reminders[n - 1];
  if (!reminder) { await ctx.reply("Напоминание не найдено.", { reply_markup: remindersMenuKeyboard }); return; }
  const deleted = await deleteReminder(user.id, reminder.id); await ctx.reply(deleted ? "🗑 Напоминание удалено." : "Напоминание не найдено.", { reply_markup: remindersMenuKeyboard });
});

remindersComposer.callbackQuery(/^reminders:delete_confirm:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const deleted = await deleteReminder(user.id, Number(ctx.match[1]));
  await ctx.editMessageText(deleted ? "🗑 Напоминание удалено." : "Напоминание не найдено или уже отправлено.", { reply_markup: remindersMenuKeyboard });
});

remindersComposer.callbackQuery("session:cancel", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await clearSession(user.id); await ctx.editMessageText("Отменено.", { reply_markup: remindersMenuKeyboard }); });

async function handleReminderEditInput(ctx: any, userId: number, text: string, draft: ReminderDraft): Promise<boolean> {
  if (!draft.editMode || !draft.editReminderId) return false;
  const id = draft.editReminderId;
  const user = await getOrCreateUser(BigInt(ctx.from!.id));

  try {
    if (draft.editMode === "text") {
      await updateReminderGroup(userId, id, { text });
      await clearSession(userId);
      await ctx.reply("✅ Текст напоминания обновлён для всей серии.", { reply_markup: remindersMenuKeyboard });
      return true;
    }

    const { DateTime } = await import("luxon");
    const group = await getReminderGroup(userId, id);
    if (!group.length) {
      await clearSession(userId);
      await ctx.reply("Напоминание не найдено.", { reply_markup: remindersMenuKeyboard });
      return true;
    }

    let newFirst: Date;
    if (draft.editMode === "date") {
      const parsed = DateTime.fromFormat(text.trim(), "dd.MM.yyyy", { zone: user.timezone });
      if (!parsed.isValid) throw new ValidationError("Неверная дата. Используйте DD.MM.YYYY.");
      const current = DateTime.fromJSDate(group[0]!.dueAt, { zone: user.timezone });
      newFirst = parsed.set({ hour: current.hour, minute: current.minute, second: current.second, millisecond: 0 }).toJSDate();
    } else {
      const parsed = DateTime.fromFormat(text.trim(), "HH:mm", { zone: user.timezone });
      if (!parsed.isValid) throw new ValidationError("Неверное время. Используйте HH:mm.");
      const current = DateTime.fromJSDate(group[0]!.dueAt, { zone: user.timezone });
      newFirst = current.set({ hour: parsed.hour, minute: parsed.minute, second: 0, millisecond: 0 }).toJSDate();
    }

    await updateReminderGroup(userId, id, { dueAt: newFirst });
    await clearSession(userId);
    await ctx.reply("✅ Изменение применено ко всей серии напоминаний.", { reply_markup: remindersMenuKeyboard });
  } catch (err) {
    if (err instanceof ValidationError) await ctx.reply(`⚠️ ${err.message}`, { reply_markup: cancelKeyboard });
    else throw err;
  }
  return true;
}

export async function handleReminderTextInput(ctx: any, userId: number): Promise<boolean> {
  const session = await getSession(userId); if (!session) return false;
  const text = ctx.message?.text as string | undefined; if (!text) return false;
  const draft = (session.draft as ReminderDraft | null) ?? {};
  if (session.step === SessionStep.REMINDER_AWAITING_DATETIME && draft.editMode) {
    return handleReminderEditInput(ctx, userId, text.trim(), draft);
  }
  if (session.step === SessionStep.REMINDER_AWAITING_TEXT) {
    try { const trimmed = text.trim(); if (!trimmed) throw new ValidationError("Текст напоминания не может быть пустым."); if (trimmed.length > 1000) throw new ValidationError("Слишком длинный текст (максимум 1000 символов)."); await setSessionStep(userId, SessionStep.REMINDER_AWAITING_DATETIME, { text: trimmed }); await ctx.reply("Введите дату и время в формате DD.MM.YYYY HH:mm:", { reply_markup: cancelKeyboard }); }
    catch (err) { if (err instanceof ValidationError) await ctx.reply(`⚠️ ${err.message}\nПопробуйте ещё раз:`, { reply_markup: cancelKeyboard }); else throw err; }
    return true;
  }
  if (session.step === SessionStep.REMINDER_AWAITING_DATETIME) {
    const draft = (session.draft as ReminderDraft | null) ?? {};
    if (draft.awaitingRepeatCount) {
      const count = Number(text.trim());
      if (!Number.isInteger(count) || count < 2 || count > 52 || !draft.text || !draft.dueAt || !draft.repeatRule) { await ctx.reply("⚠️ Введите целое число повторов от 2 до 52.", { reply_markup: cancelKeyboard }); return true; }
      const first = new Date(draft.dueAt); const rule = draft.repeatRule;
      const { DateTime } = await import("luxon"); const user = await getOrCreateUser(BigInt(ctx.from!.id));
      const reminders: Date[] = [];
      for (let i = 0; i < count; i++) {
        const dt = DateTime.fromJSDate(first, { zone: user.timezone });
        const next = rule === "daily" ? dt.plus({ days: i }) : rule === "weekly" ? dt.plus({ weeks: i }) : dt.plus({ months: i });
        reminders.push(next.toJSDate());
      }
      try {
        const repeatGroupId = randomUUID();
        for (const dueAt of reminders) await createReminder(userId, draft.text, dueAt, draft.voiceFileId, { repeatGroupId, repeatRule: rule });
        await clearSession(userId);
        await ctx.reply(`✅ Создано повторяющихся напоминаний: ${count}.\nПервое: ${formatLocalDateTime(reminders[0]!, user.timezone)}\nПоследнее: ${formatLocalDateTime(reminders[reminders.length - 1]!, user.timezone)}`, { reply_markup: remindersMenuKeyboard });
      } catch (err) { if (err instanceof ValidationError) await ctx.reply(`⚠️ ${err.message}`, { reply_markup: cancelKeyboard }); else throw err; }
      return true;
    }
    try {
      const user = await getOrCreateUser(BigInt(ctx.from!.id)); const dueAt = parseLocalDateTime(text.trim(), user.timezone);
      if (!dueAt) throw new ValidationError("Неверный формат даты и времени. Используйте DD.MM.YYYY HH:mm.");
      await setSessionStep(userId, SessionStep.REMINDER_AWAITING_DATETIME, { ...(session.draft as any), dueAt: dueAt.toISOString() });
      await ctx.reply("🔁 Нужно повторять это напоминание?", { reply_markup: repeatKeyboard() });
    } catch (err) { if (err instanceof ValidationError) await ctx.reply(`⚠️ ${err.message}\nВведите другую дату и время:`, { reply_markup: cancelKeyboard }); else throw err; }
    return true;
  }
  return false;
}

export async function handleReminderVoiceInput(ctx: any, userId: number): Promise<boolean> {
  const session = await getSession(userId); if (!session || session.step !== SessionStep.REMINDER_AWAITING_TEXT) return false;
  const voiceFileId = ctx.message?.voice?.file_id as string | undefined; if (!voiceFileId) return false;
  await setSessionStep(userId, SessionStep.REMINDER_AWAITING_DATETIME, { text: VOICE_NOTE_TEXT, voiceFileId });
  await ctx.reply("🎙️ Голосовое сохранено. Теперь введите дату и время в формате DD.MM.YYYY HH:mm:", { reply_markup: cancelKeyboard });
  return true;
}
