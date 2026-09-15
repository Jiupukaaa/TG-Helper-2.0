import { Composer, InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import { getOrCreateUser } from "@/bot/session";
import { prisma } from "@/lib/prisma";

export const shiftCalendarComposer = new Composer();
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

async function renderCalendar(ctx: any, userId: number, monthIso?: string) {
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const month = DateTime.fromISO(
    monthIso ?? DateTime.now().setZone(user.timezone).toFormat("yyyy-MM-01"),
    { zone: user.timezone },
  ).startOf("month");
  const shifts = await prisma.shift.findMany({
    where: {
      ownerId: userId,
      startAt: {
        gte: month.toUTC().toJSDate(),
        lt: month.plus({ months: 1 }).toUTC().toJSDate(),
      },
    },
    orderBy: { startAt: "asc" },
  });
  const byDay = new Map<number, number>();
  for (const shift of shifts) {
    const d = DateTime.fromJSDate(shift.startAt, { zone: "utc" }).setZone(user.timezone).day;
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }

  const k = new InlineKeyboard();
  k.text("‹", `shift:calendar:month:${month.minus({ months: 1 }).toFormat("yyyy-MM-01")}`)
    .text(month.toFormat("LLLL yyyy"), "shift:calendar:noop")
    .text("›", `shift:calendar:month:${month.plus({ months: 1 }).toFormat("yyyy-MM-01")}`)
    .row();
  DAYS.forEach((d) => k.text(d, "shift:calendar:noop"));
  k.row();

  for (let i = 1; i < month.startOf("month").weekday; i++) k.text(" ", "shift:calendar:noop");
  for (let day = 1; day <= (month.daysInMonth ?? 0); day++) {
    const count = byDay.get(day) ?? 0;
    const label = count ? `🟢${day}` : String(day);
    k.text(label, "shift:calendar:noop");
    if (month.set({ day }).weekday === 7) k.row();
  }
  if (month.endOf("month").weekday !== 7) k.row();

  const upcoming = shifts
    .slice(0, 8)
    .map((s) => {
      const local = DateTime.fromJSDate(s.startAt, { zone: "utc" }).setZone(user.timezone);
      return `• ${local.toFormat("dd.MM HH:mm")}${s.name ? ` — ${s.name}` : ""}`;
    })
    .join("\n");
  const text = `📅 Календарь смен\n\n🟢 — есть смена\n\n${upcoming ? `Ближайшие в этом месяце:\n${upcoming}` : "В этом месяце смен нет."}`;
  k.row().text("📋 Мои смены", "shift:list").text("🏠 Главная", "menu:main");
  await ctx.editMessageText(text, { reply_markup: k });
}

shiftCalendarComposer.callbackQuery("shift:calendar", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await renderCalendar(ctx, user.id);
});

shiftCalendarComposer.callbackQuery("shift:calendar:noop", async (ctx) => {
  await ctx.answerCallbackQuery();
});

shiftCalendarComposer.callbackQuery(/^shift:calendar:month:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await renderCalendar(ctx, user.id, ctx.match[1]);
});
