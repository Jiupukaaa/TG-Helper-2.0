import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "grammy";
import { getBot } from "@/bot/client";
import { registerHandlers } from "@/bot/commands";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let handlersRegistered = false;

function ensureHandlers() {
  if (!handlersRegistered) {
    registerHandlers(getBot());
    handlersRegistered = true;
  }
}

export async function POST(req: NextRequest) {
  // Telegram sends this header verbatim when the webhook is registered with
  // a secret_token (see README "Setting the webhook"). Anyone who doesn't
  // know the secret cannot make this endpoint execute bot commands.
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
  if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  ensureHandlers();
  const bot = getBot();
  const handleUpdate = webhookCallback(bot, "std/http");

  try {
    return await handleUpdate(req);
  } catch (err) {
    console.error("Webhook processing error:", (err as Error).message);
    // Still return 200 so Telegram doesn't retry-storm us for an internal
    // error that a retry won't fix; the error is already logged.
    return NextResponse.json({ ok: true });
  }
}

// Telegram never sends GET; this just gives a sane response if someone
// opens the URL in a browser instead of leaking a 500.
export async function GET() {
  return NextResponse.json({ ok: true, message: "TG Helper webhook is running." });
}
