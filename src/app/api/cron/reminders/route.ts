import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getBot } from "@/bot/client";
import { claimDueReminders, markReminderSent, markReminderFailed } from "@/services/remindersService";
import { cleanupPastShifts } from "@/services/shiftsService";
import { formatLocalDateTime } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isPermanentTelegramError(err: unknown): boolean {
  const description = (err as { description?: string })?.description ?? "";
  const errorCode = (err as { error_code?: number })?.error_code;
  if (errorCode === 403) return true;
  if (/chat not found/i.test(description)) return true;
  if (/user is deactivated/i.test(description)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bot = getBot();
  const cleanedShifts = await cleanupPastShifts();
  const claimed = await claimDueReminders();
  let sent = 0;
  let failed = 0;

  for (const reminder of claimed) {
    try {
      const chatId = Number(reminder.owner.telegramId);
      if (reminder.voiceFileId) {
        await bot.api.sendVoice(chatId, reminder.voiceFileId, {
          caption: `⏰ Напоминание (${formatLocalDateTime(reminder.dueAt, reminder.owner.timezone)})`,
        });
      } else {
        const localTime = formatLocalDateTime(reminder.dueAt, reminder.owner.timezone);
        await bot.api.sendMessage(chatId, `⏰ Напоминание (${localTime}):\n${reminder.text}`);
      }
      await markReminderSent(reminder.id);
      sent++;
    } catch (err) {
      const permanent = isPermanentTelegramError(err);
      const message = err instanceof Error ? err.message : "unknown error";
      await markReminderFailed(reminder.id, message, permanent);
      failed++;
      console.error(`Reminder ${reminder.id} delivery failed:`, message);
    }
  }

  return NextResponse.json({ ok: true, cleanedShifts, claimed: claimed.length, sent, failed });
}

export const GET = POST;
