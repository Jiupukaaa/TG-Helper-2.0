import { Composer, InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import { SessionStep } from "@/db/types";
import { getOrCreateUser, setSessionStep, clearSession, getSession } from "@/bot/session";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { createShifts, deleteAllShiftGroups, deleteShift, deleteShiftGroup, listUpcomingShifts, listUpcomingShiftsInGroup, listShiftsInRange, getOwnedShift, updateShift } from "@/services/shiftsService";
import { mainMenuKeyboard } from "@/bot/keyboards";

export const shiftsComposer = new Composer();
const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
type Draft = { dates?: string[]; calendarMonth?: string; time?: string; workDays?: number; offDays?: number; firstDate?: string; editShiftId?: number; pendingStarts?: string[] };
const draftOf = (session: any): Draft => (session?.draft as Draft | null) ?? {};
function parseTime(input: string) { const m = /^(\d{2}):(\d{2})$/.exec(input.trim()); if (!m) return null; const hour = Number(m[1]), minute = Number(m[2]); return hour <= 23 && minute <= 59 ? { hour, minute } : null; }
function parseDate(input: string, timezone: string) { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input.trim()); if (!m) return null; const dt = DateTime.fromObject({ day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) }, { zone: timezone }); return dt.isValid ? dt.startOf("day") : null; }
function shiftStart(date: DateTime, time: { hour: number; minute: number }) { return date.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 }).toJSDate(); }
function parseShiftName(input: string) { const value = input.trim(); if (!value || value === "-") return null; return value.length <= 100 ? value : null; }
function calendarKeyboard(month: DateTime, selected: string[]) { const keyboard = new InlineKeyboard(); const daysInMonth = month.daysInMonth ?? 0; keyboard.text("‹", `shift:manual:month:${month.minus({ months: 1 }).toFormat("yyyy-MM-dd")}`).text(month.toFormat("LLLL yyyy"), "shift:manual:noop").text("›", `shift:manual:month:${month.plus({ months: 1 }).toFormat("yyyy-MM-dd")}`).row(); DAY_NAMES.forEach((d) => keyboard.text(d, "shift:manual:noop")); keyboard.row(); for (let i = 1; i < month.startOf("month").weekday; i++) keyboard.text(" ", "shift:manual:noop"); for (let day = 1; day <= daysInMonth; day++) { const date = month.set({ day }), key = date.toFormat("yyyy-MM-dd"); keyboard.text(selected.includes(key) ? `✅${day}` : String(day), `shift:manual:date:${key}`); if (date.weekday === 7) keyboard.row(); } if (month.endOf("month").weekday !== 7) keyboard.row(); keyboard.text(`Готово (${selected.length})`, "shift:manual:done").row().text("❌ Отмена", "shift:cancel"); return keyboard; }
async function showManualCalendar(ctx: any, userId: number, monthInput?: string) { const draft = draftOf(await getSession(userId)); const month = DateTime.fromISO(monthInput ?? draft.calendarMonth ?? DateTime.now().toFormat("yyyy-MM-01"), { zone: "utc" }).startOf("month"); await ctx.editMessageText("📅 Выберите одну или несколько дат смен. Выбранные даты отмечены ✅:", { reply_markup: calendarKeyboard(month.isValid ? month : DateTime.now().startOf("month"), draft.dates ?? []) }); }
async function showScheduleMenu(ctx: any, mode: "reply" | "edit") { const keyboard = new InlineKeyboard().text("➕ Выбрать даты", "shift:manual:start").row().text("🔄 Настроить график", "shift:cycle:start").row().text("📋 Мои смены", "shift:list").row().text("🕒 Свободное время", "shift:free:start").row().text("⬅️ Назад", "menu:main"); if (mode === "reply") await ctx.reply("📅 График работы:", { reply_markup: keyboard }); else await ctx.editMessageText("📅 График работы:", { reply_markup: keyboard }); }
shiftsComposer.command("shifts", async (ctx) => showScheduleMenu(ctx, "reply"));
shiftsComposer.callbackQuery("menu:shifts", async (ctx) => { await ctx.answerCallbackQuery(); await showScheduleMenu(ctx, "edit"); });
shiftsComposer.callbackQuery("shift:manual:start", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); if (user.timezone === DEFAULT_TIMEZONE) { await ctx.editMessageText("Сначала укажите часовой пояс:\n/settimezone Europe/Amsterdam"); return; } const month = DateTime.now().setZone(user.timezone).startOf("month").toFormat("yyyy-MM-dd"); await setSessionStep(user.id, SessionStep.SHIFT_MANUAL_AWAITING_TIME, { dates: [], calendarMonth: month }); await showManualCalendar(ctx, user.id, month); });
shiftsComposer.callbackQuery("shift:manual:noop", async (ctx) => { await ctx.answerCallbackQuery(); });
shiftsComposer.callbackQuery(/^shift:manual:month:(\d{4}-\d{2}-\d{2})$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const draft = draftOf(await getSession(user.id)); const monthValue = ctx.match[1]!; await setSessionStep(user.id, SessionStep.SHIFT_MANUAL_AWAITING_TIME, { ...draft, calendarMonth: monthValue }); await showManualCalendar(ctx, user.id, monthValue); });
shiftsComposer.callbackQuery(/^shift:manual:date:(\d{4}-\d{2}-\d{2})$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const draft = draftOf(await getSession(user.id)); const dateValue = ctx.match[1]!; const dates = new Set(draft.dates ?? []); dates.has(dateValue) ? dates.delete(dateValue) : dates.add(dateValue); await setSessionStep(user.id, SessionStep.SHIFT_MANUAL_AWAITING_TIME, { ...draft, dates: [...dates].sort() }); await showManualCalendar(ctx, user.id, draft.calendarMonth); });
shiftsComposer.callbackQuery("shift:manual:done", async (ctx) => { const user = await getOrCreateUser(BigInt(ctx.from.id)); const draft = draftOf(await getSession(user.id)); if (!draft.dates?.length) { await ctx.answerCallbackQuery({ text: "Выберите хотя бы одну дату.", show_alert: true }); return; } await ctx.answerCallbackQuery(); await ctx.editMessageText("⏰ Введите время начала смены в формате HH:mm\nНапример: 14:00", { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") }); });
shiftsComposer.callbackQuery("shift:cycle:start", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); if (user.timezone === DEFAULT_TIMEZONE) { await ctx.editMessageText("Сначала укажите часовой пояс:\n/settimezone Europe/Amsterdam"); return; } await setSessionStep(user.id, SessionStep.SHIFT_CYCLE_AWAITING_WORK_DAYS, {}); await ctx.editMessageText("🔄 Выберите график:", { reply_markup: new InlineKeyboard().text("2/2", "shift:cycle:preset:2:2").text("3/3", "shift:cycle:preset:3:3").text("5/2", "shift:cycle:preset:5:2").row().text("Другой цикл", "shift:cycle:custom").row().text("❌ Отмена", "shift:cancel") }); });
async function startCycle(ctx: any, workDays: number, offDays: number) { const user = await getOrCreateUser(BigInt(ctx.from.id)); await setSessionStep(user.id, SessionStep.SHIFT_CYCLE_AWAITING_START_DATE, { workDays, offDays }); await ctx.editMessageText(`🔄 График ${workDays}/${offDays}.\n\nВведите первую рабочую дату в формате DD.MM.YYYY`, { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") }); }
shiftsComposer.callbackQuery(/^shift:cycle:preset:(\d+):(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await startCycle(ctx, Number(ctx.match[1]!), Number(ctx.match[2]!)); });
shiftsComposer.callbackQuery("shift:cycle:custom", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await setSessionStep(user.id, SessionStep.SHIFT_CYCLE_AWAITING_WORK_DAYS, {}); await ctx.editMessageText("Сколько рабочих дней подряд? Введите число, например 2.", { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") }); });

shiftsComposer.callbackQuery("shift:list", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const shifts = await listUpcomingShifts(user.id); if (!shifts.length) { await ctx.editMessageText("📋 Будущих смен пока нет.", { reply_markup: new InlineKeyboard().text("🗑 Удалить все повторяющиеся", "shift:groups:delete").row().text("⬅️ Назад", "menu:shifts") }); return; } const keyboard = new InlineKeyboard(); const lines = shifts.map((s, i) => { keyboard.text(`#${i + 1}`, `shift:actions:${s.id}`).text("🗑", `shift:delete:${s.id}`); if (s.cycleGroupId) keyboard.text("🗑 график", `shift:group:delete:${s.cycleGroupId}`); keyboard.row(); const localStart = DateTime.fromJSDate(s.startAt, { zone: "utc" }).setZone(user.timezone).toFormat("dd.MM.yyyy HH:mm"); const localEnd = s.endAt ? DateTime.fromJSDate(s.endAt, { zone: "utc" }).setZone(user.timezone).toFormat("HH:mm") : "окончание не задано"; return `${i + 1}. ${s.name ? `${s.name} — ` : ""}${localStart}–${localEnd}`; }); keyboard.text("🗑 Удалить все повторяющиеся", "shift:groups:delete").row(); keyboard.text("⬅️ Назад", "menu:shifts"); await ctx.editMessageText(`📋 Будущие смены:\n\n${lines.join("\n")}\n\nВыберите действие для смены:`, { reply_markup: keyboard }); });
shiftsComposer.callbackQuery("shift:groups:delete", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const shifts = (await listUpcomingShifts(user.id)).filter((shift) => Boolean(shift.cycleGroupId)); if (!shifts.length) { await ctx.editMessageText("Повторяющихся будущих смен нет.", { reply_markup: new InlineKeyboard().text("📋 Мои смены", "shift:list") }); return; } await ctx.editMessageText(`Удалить все повторяющиеся будущие смены (${shifts.length} шт.)?\n\nБудут удалены все смены, созданные через циклический график, и их будущие напоминания. Обычные смены, созданные вручную, не будут затронуты.`, { reply_markup: new InlineKeyboard().text("✅ Да, удалить все", "shift:groups:delete:confirm").text("❌ Нет", "shift:list") }); });
shiftsComposer.callbackQuery("shift:groups:delete:confirm", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const deleted = await deleteAllShiftGroups(user.id); await ctx.editMessageText(deleted ? `🗑 Удалено повторяющихся смен: ${deleted}.\nБудущие напоминания тоже удалены.` : "Повторяющихся будущих смен уже нет.", { reply_markup: new InlineKeyboard().text("📋 Мои смены", "shift:list").row().text("⬅️ Назад", "menu:shifts") }); });
shiftsComposer.callbackQuery(/^shift:actions:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const shift = await getOwnedShift(user.id, Number(ctx.match[1]!)); if (!shift || shift.startAt <= new Date()) { await ctx.editMessageText("Смена уже недоступна.", { reply_markup: new InlineKeyboard().text("⬅️ Назад", "shift:list") }); return; } const local = DateTime.fromJSDate(shift.startAt, { zone: "utc" }).setZone(user.timezone).toFormat("dd.MM.yyyy HH:mm"); const localEnd = shift.endAt ? DateTime.fromJSDate(shift.endAt, { zone: "utc" }).setZone(user.timezone).toFormat("HH:mm") : "окончание не задано"; const keyboard = new InlineKeyboard().text("✏️ Изменить", `shift:edit:${shift.id}`).text("🗑 Удалить", `shift:delete:${shift.id}`).row(); if (shift.cycleGroupId) keyboard.text("🗑 Удалить весь график", `shift:group:delete:${shift.cycleGroupId}`).row(); keyboard.text("⬅️ Назад", "shift:list"); await ctx.editMessageText(`${shift.name ? `📌 ${shift.name}\n` : ""}Смена ${local}–${localEnd}:${shift.cycleGroupId ? "\n\nЭта смена создана в составе циклического графика." : ""}`, { reply_markup: keyboard }); });
shiftsComposer.callbackQuery(/^shift:group:delete:([a-f0-9-]+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const groupId = ctx.match[1]!; const shifts = await listUpcomingShiftsInGroup(user.id, groupId); if (!shifts.length) { await ctx.editMessageText("Циклический график не найден или в нём не осталось будущих смен.", { reply_markup: new InlineKeyboard().text("📋 Мои смены", "shift:list") }); return; } await ctx.editMessageText(`Удалить все будущие смены этого графика (${shifts.length} шт.)?\n\n${shifts[0]?.name ? `Название: ${shifts[0].name}\n` : ""}Все будущие смены и их напоминания будут удалены.`, { reply_markup: new InlineKeyboard().text("✅ Да, удалить график", `shift:group:delete:confirm:${groupId}`).text("❌ Нет", "shift:list") }); });
shiftsComposer.callbackQuery(/^shift:group:delete:confirm:([a-f0-9-]+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const deleted = await deleteShiftGroup(user.id, ctx.match[1]!); await ctx.editMessageText(deleted ? `🗑 Удалено смен из графика: ${deleted}.\nБудущие напоминания тоже удалены.` : "Будущих смен этого графика уже нет.", { reply_markup: new InlineKeyboard().text("📋 Мои смены", "shift:list").row().text("⬅️ Назад", "menu:shifts") }); });
shiftsComposer.callbackQuery(/^shift:edit:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const shift = await getOwnedShift(user.id, Number(ctx.match[1]!)); if (!shift || shift.startAt <= new Date()) { await ctx.editMessageText("Смена уже недоступна для изменения.", { reply_markup: new InlineKeyboard().text("⬅️ Назад", "shift:list") }); return; } await setSessionStep(user.id, SessionStep.SHIFT_MANUAL_AWAITING_TIME, { editShiftId: shift.id }); await ctx.editMessageText("✏️ Введите новую дату и время начала в формате DD.MM.YYYY HH:mm\nНапример: 25.09.2026 14:00", { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") }); });
shiftsComposer.callbackQuery(/^shift:delete:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const shift = await getOwnedShift(user.id, Number(ctx.match[1]!)); if (!shift || shift.startAt <= new Date()) { await ctx.editMessageText("Смена уже недоступна для удаления.", { reply_markup: new InlineKeyboard().text("⬅️ Назад", "shift:list") }); return; } const local = DateTime.fromJSDate(shift.startAt, { zone: "utc" }).setZone(user.timezone).toFormat("dd.MM.yyyy HH:mm"); await ctx.editMessageText(`Удалить смену ${shift.name ? `«${shift.name}» ` : ""}${local}?`, { reply_markup: new InlineKeyboard().text("✅ Да", `shift:delete:confirm:${shift.id}`).text("❌ Нет", "shift:list") }); });
shiftsComposer.callbackQuery(/^shift:delete:confirm:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const deleted = await deleteShift(user.id, Number(ctx.match[1]!)); await ctx.editMessageText(deleted ? "🗑 Смена и её будущие напоминания удалены." : "Смена не найдена или уже началась.", { reply_markup: new InlineKeyboard().text("📋 Мои смены", "shift:list").row().text("⬅️ Назад", "menu:shifts") }); });
shiftsComposer.callbackQuery("shift:free:start", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await setSessionStep(user.id, SessionStep.SHIFT_CYCLE_AWAITING_START_DATE, { freeTime: true }); await ctx.editMessageText("🕒 За какую дату начать расчёт свободного времени? Введите DD.MM.YYYY", { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") }); });
shiftsComposer.callbackQuery("shift:cancel", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await clearSession(user.id); await ctx.editMessageText("Отменено.", { reply_markup: mainMenuKeyboard }); });

function shiftEnd(date: DateTime, time: { hour: number; minute: number }, startAt: Date): Date {
  let end = date.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
  if (end.toMillis() <= startAt.getTime()) end = end.plus({ days: 1 });
  return end.toJSDate();
}

async function freeTimeReport(userId: number, timezone: string, startDate: DateTime, endDate: DateTime): Promise<string> {
  const rangeStart = startDate.startOf("day");
  const rangeEnd = endDate.plus({ days: 1 }).startOf("day");
  const shifts = await listShiftsInRange(userId, rangeStart.toJSDate(), rangeEnd.toJSDate());
  const lines: string[] = [];
  let totalMinutes = 0;
  for (let day = rangeStart; day < rangeEnd; day = day.plus({ days: 1 })) {
    const dayStart = day.toMillis();
    const dayEnd = day.plus({ days: 1 }).toMillis();
    const daily = shifts.filter((shift) => shift.startAt.getTime() < dayEnd && (!shift.endAt || shift.endAt.getTime() > dayStart));
    if (daily.some((shift) => !shift.endAt)) {
      lines.push(`⚠️ ${day.toFormat("dd.MM.yyyy")}: есть смена без указанного окончания — расчёт за этот день неполный.`);
      continue;
    }
    const busy = daily
      .filter((shift) => shift.endAt)
      .map((shift) => ({ start: Math.max(dayStart, shift.startAt.getTime()), end: Math.min(dayEnd, shift.endAt!.getTime()) }))
      .filter((interval) => interval.end > interval.start)
      .sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const interval of busy) {
      const last = merged[merged.length - 1];
      if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
      else merged.push({ ...interval });
    }
    const free: { start: number; end: number }[] = [];
    let cursor = dayStart;
    for (const interval of merged) {
      if (interval.start > cursor) free.push({ start: cursor, end: interval.start });
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });
    const minutes = free.reduce((sum, interval) => sum + Math.round((interval.end - interval.start) / 60000), 0);
    totalMinutes += minutes;
    const periods = free.map((interval) => {
      const from = DateTime.fromMillis(interval.start, { zone: "utc" }).setZone(timezone).toFormat("HH:mm");
      const to = DateTime.fromMillis(interval.end, { zone: "utc" }).setZone(timezone).toFormat("HH:mm");
      const duration = (interval.end - interval.start) / 3600000;
      return `${from}–${to} (${duration.toFixed(1)} ч)`;
    });
    lines.push(`📅 ${day.toFormat("dd.MM.yyyy")} — ${(minutes / 60).toFixed(1)} ч свободно${periods.length ? `\n${periods.join(", ")}` : "\nСвободных интервалов нет"}`);
  }
  return `🕒 Свободное время с ${rangeStart.toFormat("dd.MM.yyyy")} по ${endDate.toFormat("dd.MM.yyyy")}\n\n${lines.join("\n\n")}\n\nВсего: ${(totalMinutes / 60).toFixed(1)} ч.`;
}

export async function handleShiftTextInput(ctx: any, userId: number): Promise<boolean> {
  const session = await getSession(userId);
  if (!session) return false;
  const text = ctx.message?.text?.trim();
  if (!text) return false;
  const draft = draftOf(session);
  const user = await getOrCreateUser(BigInt(ctx.from.id));

  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_START_DATE && draft.freeTime) {
    const start = parseDate(text, user.timezone);
    if (!start) { await ctx.reply("⚠️ Неверная дата. Используйте DD.MM.YYYY."); return true; }
    await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_END_DATE, { freeTime: true, freeStartDate: start.toISODate()! });
    await ctx.reply("Введите последнюю дату периода (DD.MM.YYYY).");
    return true;
  }

  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_END_DATE && draft.freeTime) {
    const end = parseDate(text, user.timezone);
    const start = draft.freeStartDate ? DateTime.fromISO(draft.freeStartDate, { zone: user.timezone }) : null;
    if (!end || !start?.isValid) { await ctx.reply("⚠️ Не удалось распознать даты периода. Начните заново через /shifts."); return true; }
    if (end < start) { await ctx.reply("Конец периода не может быть раньше начала."); return true; }
    if (end.diff(start, "days").days > 365) { await ctx.reply("Период не должен превышать 366 дней."); return true; }
    const report = await freeTimeReport(userId, user.timezone, start, end);
    await clearSession(userId);
    await ctx.reply(report, { reply_markup: new InlineKeyboard().text("⬅️ К графику", "menu:shifts") });
    return true;
  }

  if (session.step === SessionStep.SHIFT_MANUAL_AWAITING_TIME && draft.editShiftId) {
    if (!draft.pendingStarts?.length) {
      const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(text);
      const date = parseDate(text.split(" ")[0] ?? "", user.timezone);
      const time = parseTime(text.split(" ")[1] ?? "");
      if (!match || !date || !time) { await ctx.reply("⚠️ Неверный формат. Используйте DD.MM.YYYY HH:mm."); return true; }
      const startAt = shiftStart(date, time);
      await setSessionStep(userId, SessionStep.SHIFT_MANUAL_AWAITING_TIME, { editShiftId: draft.editShiftId, pendingStarts: [startAt.toISOString()], time: text.split(" ")[1] });
      await ctx.reply("⏰ Введите новое время окончания смены (HH:mm). Если смена заканчивается после полуночи, укажите время следующего дня.");
      return true;
    }
    const endTime = parseTime(text);
    const startAt = new Date(draft.pendingStarts[0]!);
    if (!endTime) { await ctx.reply("⚠️ Неверное время. Используйте HH:mm."); return true; }
    const startLocal = DateTime.fromJSDate(startAt, { zone: "utc" }).setZone(user.timezone);
    const endAt = shiftEnd(startLocal.startOf("day"), endTime, startAt);
    await setSessionStep(userId, SessionStep.SHIFT_EDIT_AWAITING_NAME, { editShiftId: draft.editShiftId, pendingStarts: [startAt.toISOString()], pendingEnds: [endAt.toISOString()] });
    await ctx.reply("📌 Введите новое название смены (до 100 символов). Если название не нужно — отправьте -.", { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") });
    return true;
  }

  if (session.step === SessionStep.SHIFT_EDIT_AWAITING_NAME) {
    const name = parseShiftName(text);
    if (text !== "-" && !name) { await ctx.reply("⚠️ Название должно быть от 1 до 100 символов. Для названия без текста отправьте -."); return true; }
    const start = draft.pendingStarts?.[0];
    const end = draft.pendingEnds?.[0];
    if (!start || !end || !draft.editShiftId) { await clearSession(userId); await ctx.reply("⚠️ Не удалось собрать параметры изменения. Начните заново через /shifts."); return true; }
    try {
      const updated = await updateShift(userId, draft.editShiftId, new Date(start), new Date(end), user.timezone, name);
      await clearSession(userId);
      await ctx.reply(updated ? `✅ Смена изменена${name ? `: ${name}` : "."}` : "Смена не найдена или уже началась.", { reply_markup: new InlineKeyboard().text("📋 Мои смены", "shift:list") });
    } catch (err) { await ctx.reply(`⚠️ ${err instanceof Error ? err.message : "Не удалось изменить смену."}`); }
    return true;
  }

  if (session.step === SessionStep.SHIFT_MANUAL_AWAITING_TIME) {
    if (!draft.dates?.length) return false;
    if (!draft.time) {
      const startTime = parseTime(text);
      if (!startTime) { await ctx.reply("⚠️ Неверное время начала. Используйте HH:mm, например 14:00."); return true; }
      const starts = draft.dates.map((iso) => shiftStart(DateTime.fromISO(iso, { zone: user.timezone }), startTime));
      await setSessionStep(userId, SessionStep.SHIFT_MANUAL_AWAITING_TIME, { ...draft, time: text, pendingStarts: starts.map((d) => d.toISOString()) });
      await ctx.reply("⏰ Введите время окончания смены (HH:mm). Для смены через полночь укажите время следующего дня.");
      return true;
    }
    const endTime = parseTime(text);
    if (!endTime) { await ctx.reply("⚠️ Неверное время окончания. Используйте HH:mm."); return true; }
    const starts = (draft.pendingStarts ?? []).map((value) => new Date(value));
    const endAts = starts.map((startAt) => {
      const localStart = DateTime.fromJSDate(startAt, { zone: "utc" }).setZone(user.timezone);
      return shiftEnd(localStart.startOf("day"), endTime, startAt);
    });
    await setSessionStep(userId, SessionStep.SHIFT_MANUAL_AWAITING_NAME, { ...draft, pendingStarts: starts.map((d) => d.toISOString()), pendingEnds: endAts.map((d) => d.toISOString()) });
    await ctx.reply("📌 Введите название смены (до 100 символов). Если название не нужно — отправьте -.", { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") });
    return true;
  }

  if (session.step === SessionStep.SHIFT_MANUAL_AWAITING_NAME) {
    const name = parseShiftName(text);
    if (text !== "-" && !name) { await ctx.reply("⚠️ Название должно быть от 1 до 100 символов. Для названия без текста отправьте -."); return true; }
    const starts = (draft.pendingStarts ?? []).map((value) => new Date(value));
    const ends = (draft.pendingEnds ?? []).map((value) => new Date(value));
    if (!starts.length || starts.length !== ends.length) { await clearSession(userId); await ctx.reply("⚠️ Не удалось собрать параметры смен. Начните заново через /shifts."); return true; }
    try {
      await createShifts(userId, starts, ends, user.timezone, name);
      await clearSession(userId);
      await ctx.reply(`✅ Создано смен: ${starts.length}${name ? `\nНазвание: ${name}` : ""}.\nДля каждой смены установлены напоминания за 6, 4, 2 часа и в момент начала.`, { reply_markup: new InlineKeyboard().text("📋 Мои смены", "shift:list") });
    } catch (err) { await ctx.reply(`⚠️ ${err instanceof Error ? err.message : "Не удалось создать смены."}`); }
    return true;
  }

  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_WORK_DAYS) {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 31) { await ctx.reply("Введите целое число рабочих дней от 1 до 31."); return true; }
    await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_OFF_DAYS, { ...draft, workDays: n });
    await ctx.reply("Сколько выходных дней подряд? Введите число, например 2.", { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") });
    return true;
  }
  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_OFF_DAYS) {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > 31) { await ctx.reply("Введите целое число выходных дней от 1 до 31."); return true; }
    await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_START_DATE, { ...draft, offDays: n });
    await ctx.reply("Введите первую рабочую дату в формате DD.MM.YYYY", { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") });
    return true;
  }
  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_START_DATE) {
    const date = parseDate(text, user.timezone);
    if (!date) { await ctx.reply("⚠️ Неверная дата. Используйте DD.MM.YYYY."); return true; }
    await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_TIME, { ...draft, firstDate: date.toISODate()! });
    await ctx.reply("⏰ Введите время начала смены (HH:mm).");
    return true;
  }
  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_TIME) {
    if (!draft.time) {
      const startTime = parseTime(text);
      if (!startTime) { await ctx.reply("⚠️ Неверное время начала. Используйте HH:mm."); return true; }
      await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_TIME, { ...draft, time: text });
      await ctx.reply("⏰ Введите время окончания смены (HH:mm).");
      return true;
    }
    const endTime = parseTime(text);
    if (!endTime) { await ctx.reply("⚠️ Неверное время окончания. Используйте HH:mm."); return true; }
    await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_END_DATE, { ...draft, endTime: text });
    await ctx.reply("📆 До какой даты создать график? Введите DD.MM.YYYY", { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") });
    return true;
  }
  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_END_DATE) {
    const endDate = parseDate(text, user.timezone);
    const first = draft.firstDate ? DateTime.fromISO(draft.firstDate, { zone: user.timezone }).startOf("day") : null;
    const startTime = draft.time ? parseTime(draft.time) : null;
    const endTime = draft.endTime ? parseTime(draft.endTime) : null;
    if (!endDate || !first?.isValid || !startTime || !endTime || !draft.workDays || !draft.offDays) { await ctx.reply("⚠️ Не удалось собрать параметры графика. Начните заново через /shifts."); await clearSession(userId); return true; }
    if (endDate < first) { await ctx.reply("Дата окончания не может быть раньше первой рабочей даты."); return true; }
    const starts: Date[] = [];
    const ends: Date[] = [];
    const cycle = draft.workDays + draft.offDays;
    for (let cursor = first; cursor <= endDate; cursor = cursor.plus({ days: 1 })) {
      const diff = Math.floor(cursor.diff(first, "days").days);
      if (diff % cycle < draft.workDays) {
        const startAt = shiftStart(cursor, startTime);
        starts.push(startAt);
        ends.push(shiftEnd(cursor, endTime, startAt));
      }
      if (starts.length > 366) break;
    }
    if (!starts.length) { await ctx.reply("⚠️ В выбранном периоде нет рабочих смен."); return true; }
    await setSessionStep(userId, SessionStep.SHIFT_CYCLE_AWAITING_NAME, { ...draft, pendingStarts: starts.map((d) => d.toISOString()), pendingEnds: ends.map((d) => d.toISOString()) });
    await ctx.reply("📌 Введите название смены для всего графика (до 100 символов). Если название не нужно — отправьте -.", { reply_markup: new InlineKeyboard().text("❌ Отмена", "shift:cancel") });
    return true;
  }
  if (session.step === SessionStep.SHIFT_CYCLE_AWAITING_NAME) {
    const name = parseShiftName(text);
    if (text !== "-" && !name) { await ctx.reply("⚠️ Название должно быть от 1 до 100 символов. Для названия без текста отправьте -."); return true; }
    const starts = (draft.pendingStarts ?? []).map((value) => new Date(value));
    const ends = (draft.pendingEnds ?? []).map((value) => new Date(value));
    if (!starts.length || starts.length !== ends.length) { await clearSession(userId); await ctx.reply("⚠️ Не удалось собрать параметры графика. Начните заново через /shifts."); return true; }
    const cycleGroupId = crypto.randomUUID();
    try {
      await createShifts(userId, starts, ends, user.timezone, name, cycleGroupId);
      await clearSession(userId);
      await ctx.reply(`✅ График ${draft.workDays}/${draft.offDays} создан. Рабочих смен: ${starts.length}${name ? `\nНазвание: ${name}` : ""}.\nДля каждой будущей смены установлены напоминания за 6, 4, 2 часа и в момент начала.`, { reply_markup: new InlineKeyboard().text("🗑 Удалить весь график", `shift:group:delete:${cycleGroupId}`).row().text("📋 Мои смены", "shift:list") });
    } catch (err) { await ctx.reply(`⚠️ ${err instanceof Error ? err.message : "Не удалось создать график."}`); }
    return true;
  }
  return false;
}
