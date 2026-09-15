import { Composer, InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import { getOrCreateUser } from "@/bot/session";
import { listUpcomingShifts } from "@/services/shiftsService";
import { listReminders } from "@/services/remindersService";
import { listNotes } from "@/services/notesService";
import { listSavedItems } from "@/services/savedService";

export const todayComposer = new Composer();

async function renderToday(ctx: any, edit = true) {
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const now = DateTime.now().setZone(user.timezone);
  const start = now.startOf("day").toJSDate();
  const end = now.endOf("day").toJSDate();
  const shifts = (await listUpcomingShifts(user.id)).filter((s) => s.startAt >= start && s.startAt <= end);
  const reminders = (await listReminders(user.id)).filter((r) => r.dueAt >= start && r.dueAt <= end);
  const notes = await listNotes(user.id);
  const saved = await listSavedItems(user.id);
  const lines: string[] = [`☀️ Сегодня — ${now.toFormat("dd.MM.yyyy")}`, ""];
  lines.push("📅 Смены");
  lines.push(shifts.length ? shifts.map((s) => `• ${s.name ? `${s.name} — ` : ""}${DateTime.fromJSDate(s.startAt, { zone: "utc" }).setZone(user.timezone).toFormat("HH:mm")}`).join("\n") : "• Сегодня смен нет.");
  lines.push("", "🔔 Напоминания");
  lines.push(reminders.length ? reminders.map((r) => `• ${formatTime(r.dueAt, user.timezone)} — ${r.voiceFileId ? "🎙️ Голосовое" : r.text}`).join("\n") : "• Сегодня напоминаний нет.");
  lines.push("", "📊 Состояние", `• 📝 Заметок: ${notes.length}`, `• 🔖 Сохраненок: ${saved.length}`);
  const k = new InlineKeyboard().text("📅 Календарь", "shift:calendar").text("📋 Смены", "shift:list").row().text("🔔 Напоминания", "menu:reminders").text("📝 Заметки", "menu:notes").row().text("🏠 Главная", "menu:main");
  if (edit) await ctx.editMessageText(lines.join("\n"), { reply_markup: k }); else await ctx.reply(lines.join("\n"), { reply_markup: k });
}
function formatTime(date: Date, timezone: string) { return DateTime.fromJSDate(date, { zone: "utc" }).setZone(timezone).toFormat("HH:mm"); }
todayComposer.command("today", async (ctx) => renderToday(ctx, false));
todayComposer.callbackQuery("menu:today", async (ctx) => { await ctx.answerCallbackQuery(); await renderToday(ctx); });
