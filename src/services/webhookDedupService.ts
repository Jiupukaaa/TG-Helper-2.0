import { batch, statement } from "@/db/client";

const RETENTION_DAYS = 7;

export async function claimWebhookUpdate(updateId: number): Promise<boolean> {
  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    throw new Error("Invalid Telegram update ID.");
  }

  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const results = await batch([
    statement("DELETE FROM webhook_dedup WHERE processedAt < ?", cutoff),
    statement(
      "INSERT INTO webhook_dedup (updateId, processedAt) VALUES (?, ?) ON CONFLICT(updateId) DO NOTHING",
      updateId,
      now,
    ),
  ]);

  return results[1]?.meta.changes === 1;
}
