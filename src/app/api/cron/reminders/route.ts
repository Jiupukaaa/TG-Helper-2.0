import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getBot } from "@/bot/client";
import { claimDueReminders, markReminderSent, markReminderFailed } from "@/services/remindersService";
import { formatLocalDateTime } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Classifies a grammyjs/Telegram API error as permanent (retrying won't
 * help — e.g. the user blocked the bot or the chat no longer exists) or
 * transient (worth retrying — rate limits, network issues, 5xx).
 */
function isPermanentTelegramError(err: unknown): boolean {
  const description = (err as { description?: string })?.description ?? "";
  const errorCode = (err as { error_code?: number })?.error_code;
  if (errorCode === 403) return true; // bot was blocked by the user, kicked, etc.
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
  const claimed = await claimDueReminders();

  let sent = 0;
  let failed = 0;

  for (const reminder of claimed) {
    try {
      const localTime = formatLocalDateTime(reminder.dueAt, reminder.owner.timezone);
      await bot.api.sendMessage(
        Number(reminder.owner.telegramId),
        `⏰ Напоминание (${localTime}):\n${reminder.text}`
      );
      // Marked SENT immediately after the API call succeeds — minimizes the
      // window in which a crash could cause a duplicate send on next run.
      // This window can't be closed to zero (Telegram delivery and our DB
      // write are two separate systems with no shared transaction), but
      // keeping the gap to a single awaited call each way is the practical
      // ceiling for an MVP without an outbox/saga pattern.
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

  return NextResponse.json({ ok: true, claimed: claimed.length, sent, failed });
}

// Vercel Cron issues GET requests by default; support both so the same
// endpoint works whether it's invoked as GET or POST.
export const GET = POST;
