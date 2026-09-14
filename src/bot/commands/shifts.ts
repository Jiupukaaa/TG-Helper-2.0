import { Composer, InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import { SessionStep } from "@prisma/client";
import { getOrCreateUser, setSessionStep, clearSession, getSession } from "@/bot/session";
import { DEFAULT_TIMEZONE, isValidTimezone } from "@/lib/time";
import { createShifts, deleteShift, listUpcomingShifts } from "@/services/shiftsService";
import { getOwnedShift } from "@/services/shiftsService";
import { mainMenuKeyboard } from "@/bot/keyboards";

export const shiftsComposer = new Composer();

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

type Draft = {
  dates?: string[];
  calendarMonth?: string;
  time?: string;
  workDays?: number;
  offDays?: number;
  firstDate?: string;
  endDate?: string;
};

function draftOf(session: any): Draft {
  return (session?.draft as Draft | null) ?? {};
}

function parseTime(input: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function parseDate(input: string, timezone: string): DateTime | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input.trim());
  if (!match) return null;
  const dt = DateTime.fromObject(
    { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) },
    { zone: timezone }
  );
  return dt.isValid ? dt.startOf("day") : null;
}

function shiftStart(date: DateTime, time: { hour: number; minute: number }): Date {
  return date.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 }).toJSDate();
}

function calendarKeyboard(month: DateTime, selected: string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const prev = month.minus({ months: 1 }).toFormat("yyyy-MM-dd");
  const next = month.plus({ months: 1 }).toFormat("yyyy-MM-dd");
  keyboard.text("‹", `shift:manual:month:${prev}`).text(month.toFormat("LLLL yyyy"), "shift:manual:noop").text("›", `shift:manual:month:${next}`).row();
  DAY_NAMES.forEach((day) => keyboard.text(day, "shift:manual:noop"));
  keyboard.row();

  const firstWeekday = month.startOf("month").weekday;
  for (let i = 1; i < firstWeekday; i++) keyboard.text(" ", "shift:manual:noop");

  for (let day = 1; day <= month.daysInMonth; day++) {
    const date = month.set({ day });
    const key = date.toFormat("yyyy-MM-dd");
    const label = selected.includes(key) ? `✅${day}` : String(day);
    keyboard.text(label, `shift:manual:date:${key}`);
    if (date.weekday === 7) keyboard.row();
  }
  if (month.endOf("month").weekday !== 7) keyboard.row();
  keyboard.text(`Готово (${selected.length})`, "shift:manual:done").row().text("❌ Отмена", "session:cancel");
  return keyboard;
}

async function showManualCalendar(ctx: any, userId: number, monthInput?: string) {
  const session = await getSession(userId);
  const draft = draftOf(session);
  const month = monthInput
    ? DateTime.fromISO(monthInput, { zone: "utc" }).startOf("month")
    : DateTime.fromISO(draft.calendarMonth ?? DateTime.now().toFormat("yyyy-MM-01"), { zone: "utc" }).startOf("month");
  const safeMonth = month.isValid ? month : DateTime.now().startOf("month");
  const selected = draft.dates ?? [];
  await ctx.editMessageText("📅 Выберите одну или несколько дат смен. Выбранные даты отмечены ✅:", {
    reply_markup: calendarKeyboard(safeMonth, selected),
  });
}

async function showScheduleMenu(ctx: any, mode: "reply" | "edit") {
  const keyboard = new InlineKeyboard()
    .text("➕ Выбрать даты", "shift:manual:start")
    .row()
    .text("🔄 Настроить график", "shift:cycle:start")
    .row()
    .text("📋 Мои смены", "shift:list")
    .row()
    .text("⬅️ Назад", "menu:main");
  if (mode === "reply") await ctx.reply("📅 График работы:", { reply_markup: keyboard });
  else await ctx.editMessageText("📅 График работы:", { reply_markup: keyboard });
}

shiftsComposer.command("shifts", async (ctx) => showScheduleMenu(ctx, "reply"));

shiftsComposer.callbackQuery("menu:shifts", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showScheduleMenu(ctx, "edit");
});

shiftsComposer.callbackQuery("shift:manual:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  if (user.timezone === DEFAULT_TIMEZONE) {
    await ctx.editMessageText("Сначала укажите часовой пояс:\n/settimezone Europe/Amsterdam");
    return;
  }
  const month = DateTime.now().setZone(user.timezone).startOf("month").toFormat("yyyy-MM-dd");
  await setSessionStep(user.id, SessionStep.SHIFT_MANUAL_AWAITING_TIME, { dates: [], calendarMonth: month });
  await showManualCalendar(ctx, user.id, month);
});

shiftsComposer.callbackQuery("shift:manual:noop", async (ctx) => ctx.answerCallbackQuery());

shiftsComposer.callbackQuery(/^shift:manual:month:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const session = await getSession(user.id);
  const draft = draftOf(session);
  await setSessionStep(user.id, SessionStep.SHIFT_MANUAL_AWAITING_TIME, { ...draft, calendarMonth: ctx.match[1] });
  await showManualCalendar(ctx, user.id, ctx.match[1]);
});

shiftsComposer.callbackQuery(/^shift:manual:date:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const session = await getSession(user.id);
  const draft = draftOf(session);
  const dates = new Set(draft.dates ?? []);
  if (dates.has(ctx.match[1])) dates.delete(ctx.match[1]); else dates.add(ctx.match[1]);
  await setSessionStep(user.id, SessionStep.SHIFT_MANUAL_AWAITING_TIME, { ...draft, dates: Array.from(dates).sort() });
  await showManualCalendar(ctx, user.id, draft.calendarMonth);
});

shiftsComposer.callbackQuery("shift:manual:done", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const session = await getSession(user.id);
  const draft = draftOf(session);
  if (!draft.dates?.length) {
    await ctx.answerCallbackQuery({ text: "Выберите хотя бы одну дату.", show_alert: true });
    return;
  }
  await setSessionStep(user.id, SessionStep.SHIFT_MANUAL_AWAITING_TIME, draft);
  await ctx.editMessageText("⏰ Введите время начала смены в формате HH:mm\nНапример: 14:00", {
    reply_markup: new InlineKeyboard().text("❌ Отмена", "session:cancel"),
  });
});

shiftsComposer.callbackQuery("shift:cycle:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  if (user.timezone === DEFAULT_TIMEZONE) {
    await ctx.editMessageText("Сначала укажите часовой пояс:\n/settimezone Europe/Amsterdam");
    return;
  }
  const keyboard = new InlineKeyboard()
    .text("2/2", "shift:cycle:preset:2:2").text("3/3", "shift:cycle:preset:3:3").text("5/2", "shift:cycle:preset:5:2")
    .row().text("Другой цикл", "shift:cycle:custom")
    .row().text("❌ Отмена", "session:cancel");
  await setSessionStep(user.id, SessionStep.SHIFT_CYCLE_AWAITING_WORK_DAYS, {});
  await ctx.editMessageText("🔄 Выберите график или задайте свой цикл:", { reply_markup: keyboard });
});

async function startCycle(ctx: any, workDays: number, offDays: number) {
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await setSessionStep(user.id, SessionStep.SHIFT_CYCLE_AWAITING_START_DATE, { workDays, offDays });
  await ctx.editMessageText(`🔄 График ${workDays}/${offDays}.\n\nВведите первую рабочую дату в формате DD.MM.YYYY`, {
    reply_markup: new InlineKeyboard().text("❌ Отмена", "session:cancel"),
  });
}

shiftsComposer.callbackQuery(/^shift:cycle:preset:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await startCycle(ctx, Number(ctx.match[1]), Number(ctx.match[2]));
});

shiftsComposer.callbackQuery("shift:cycle:custom", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await setSessionStep(user.id, SessionStep.SHIFT_CYCLE_AWAITING_WORK_DAYS, {});
  await ctx.editMessageText("Сколько рабочих дней подряд? Введите число, например 2.", {
    reply_markup: new InlineKeyboard().text("❌ Отмена", "session:cancel"),
  });
});

shiftsComposer.callbackQuery("shift:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const shifts = await listUpcomingShifts(user.id);
  if (!shifts.length) {
    await ctx.editMessageText("📋 Будущих смен пока нет.", { reply_markup: new InlineKeyboard().text("⬅️ Назад", "menu:shifts") });
    return;
  }
  const keyboard = new InlineKeyboard();
  const lines = shifts.map((shift, index) => {
    keyboard.text(`#${index + 1}`, `shift:delete:${shift.id}`);
    if (index % 3 === 2) keyboard.row();
    return `${index + 1}. ${DateTime.fromJSDate(shift.startAt, { zone: "utc" }).setZone(user.timezone).toFormat("dd.MM.yyyy HH:mm")}`;
  });
  if (shifts.length % 3 !== 0) keyboard.row();
  keyboard.text("⬅️ Назад", "menu:shifts");
  await ctx.editMessageText(`📋 Будущие смены:\n\n${lines.join("\n")}\n\nНажмите номер, чтобы удалить смену.`, { reply_markup: keyboard });
});

shiftsComposer.callbackQuery(/^shift:delete:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const shift = await getOwnedShift(user.id, Number(ctx.match[1]));
  if (!shift || shift.startAt <= new Date()) {
    await ctx.editMessageText("Смена уже недоступна для удаления.", { reply_markup: new InlineKeyboard().text("⬅️ Назад", "shift:list") });
    return;
  }
  const local = DateTime.fromJSDate(shift.startAt, { zone: "utc" }).setZone(user.timezone).toFormat("dd.MM.yyyy HH:mm");
  await ctx.editMessageText(`Удалить смену ${local}?`, {
    reply_markup: new InlineKeyboard().text("✅ Да", `shift:delete:confirm:${shift.id}`).text("❌ Нет", "shift:list"),
  });
});

shiftsComposer.callbackQuery(/^shift:delete:confirm:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const deleted = await deleteShift(user.id, Number(ctx.match[1]));
  await ctx.editMessageText(deleted ? "🗑 Смена и её будущие напоминания удалены." : "Смена не найдена или уже началась.", {
    reply_markup: new InlineKeyboard().text("📋 Мои смены", "shift:list").row().text("⬅️ Назад", "menu:shifts"),
  });
});

shiftsComposer.callbackQuery("session:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await clearSession(user.id);
  await ctx.editMessageText("Отменено.", { reply_markup: mainMenuKeyboard });
});

export async function handleShiftTextInput(ctx: any, userId: number): Promise<boolean> {
  const session = await getSession(userId);
  if (!session) return false;
  const text = ctx.message?.text?.trim();
  if (!text) return false;
  const draft = draftOf(session);
  const user = await getOrCreateUser(BigInt(ctx.from.id));

  if (session.step === SessionStep.SHIFT_MANUAL_AWAITING_TIME) {
    if (!draft.dates?.length) return false;
    const time = parseTime(text);
    if (!time) {
      await ctx.reply("⚠️ Неверное время. Используйте HH:mm, например 14:00.");
      return true;
    }
    try {
      const starts = draft.dates.map((iso) => shiftStart(DateTime.fromISO(iso, { zone: user.timezone }), time));
      await createShifts(userId, starts, user.timezone);
      await clearSession(userId);
      await ctx.reply(`✅ Создано смен: ${starts.length}. Время начала: ${text}.\nДля каждой смены установлены напоминания за 6, 4, 2 часа и в момент начала.`, { reply_markup: new InlineKeyboard().text("📋 Мои смены", "shift:list") });
    } catch (err) {
      await ctx.reply(`⚠️ ${err instanceof Error ? err.message : "Не удалось создать смены."}`);
    }
    return true;
  }

  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_WORK_DAYS) {
    const workDays = Number(text);
    if (!Number.isInteger(workDays) || workDays < 1 || workDays > 31) {
      await ctx.reply("Введите целое число рабочих дней от 1 до 31.");
      return true;
    }
    await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_OFF_DAYS, { workDays });
    await ctx.reply("Сколько выходных дней подряд? Например, 2.", { reply_markup: new InlineKeyboard().text("❌ Отмена", "session:cancel") });
    return true;
  }

  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_OFF_DAYS) {
    const offDays = Number(text);
    if (!Number.isInteger(offDays) || offDays < 1 || offDays > 31) {
      await ctx.reply("Введите целое число выходных дней от 1 до 31.");
      return true;
    }
    await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_START_DATE, { ...draft, offDays });
    await ctx.reply("Введите первую рабочую дату в формате DD.MM.YYYY", { reply_markup: new InlineKeyboard().text("❌ Отмена", "session:cancel") });
    return true;
  }

  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_START_DATE) {
    const firstDate = parseDate(text, user.timezone);
    if (!firstDate) {
      await ctx.reply("⚠️ Неверная дата. Используйте DD.MM.YYYY.");
      return true;
    }
    await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_TIME, { ...draft, firstDate: firstDate.toISODate()! });
    await ctx.reply("⏰ Введите время начала смены в формате HH:mm", { reply_markup: new InlineKeyboard().text("❌ Отмена", "session:cancel") });
    return true;
  }

  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_TIME) {
    const time = parseTime(text);
    if (!time) {
      await ctx.reply("⚠️ Неверное время. Используйте HH:mm, например 14:00.");
      return true;
    }
    await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_END_DATE, { ...draft, time: text });
    await ctx.reply("📆 До какой даты создать график? Введите DD.MM.YYYY", { reply_markup: new InlineKeyboard().text("❌ Отмена", "session:cancel") });
    return true;
  }

  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_END_DATE) {
    const endDate = parseDate(text, user.timezone);
    const firstDate = draft.firstDate ? parseDate(draft.firstDate, user.timezone) : null;
    const time = draft.time ? parseTime(draft.time) : null;
    if (!endDate || !firstDate || !time || !draft.workDays || !draft.offDays) {
      await ctx.reply("⚠️ Не удалось собрать параметры графика. Начните заново через /shifts.");
      await clearSession(userId);
      return true;
    }
    if (endDate < firstDate) {
      await ctx.reply("Дата окончания не может быть раньше первой рабочей даты.");
      return true;
    }

    const starts: Date[] = [];
    const cycleLength = draft.workDays + draft.offDays;
    for (let cursor = firstDate; cursor <= endDate; cursor = cursor.plus({ days: 1 })) {
      const diff = Math.floor(cursor.diff(firstDate, "days").days);
      if (diff % cycleLength < draft.workDays) starts.push(shiftStart(cursor, time));
      if (starts.length > 366) break;
    }

    try {
      await createShifts(userId, starts, user.timezone);
      await clearSession(userId);
      await ctx.reply(`✅ График ${draft.workDays}/${draft.offDays} создан. Рабочих смен: ${starts.length}.\nДля каждой будущей смены установлены напоминания за 6, 4, 2 часа и в момент начала.`, { reply_markup: new InlineKeyboard().text("📋 Мои смены", "shift:list") });
    } catch (err) {
      await ctx.reply(`⚠️ ${err instanceof Error ? err.message : "Не удалось создать график."}`);
    }
    return true;
  }

  return false;
}
