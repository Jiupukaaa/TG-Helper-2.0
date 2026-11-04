import { all, first, run } from "@/db/client";

const RETENTION_DAYS = 7;
const PROCESSING_LEASE_MS = 2 * 60 * 1000;

export type WebhookUpdateClaim =
  | { status: "CLAIMED"; token: string }
  | { status: "PROCESSED" }
  | { status: "BUSY" };

export async function claimWebhookUpdate(updateId: number): Promise<WebhookUpdateClaim> {
  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    throw new Error("Invalid Telegram update ID.");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + PROCESSING_LEASE_MS).toISOString();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const token = crypto.randomUUID();

  await run(
    "DELETE FROM webhook_dedup WHERE status = 'PROCESSED' AND processedAt < ?",
    cutoff,
  );

  const claimed = await all<{ updateId: number }>(
    `INSERT INTO webhook_dedup (updateId, processedAt, status, lockedUntil, lockToken, attempts)
     VALUES (?, ?, 'PROCESSING', ?, ?, 1)
     ON CONFLICT(updateId) DO UPDATE SET
       status = 'PROCESSING',
       processedAt = excluded.processedAt,
       lockedUntil = excluded.lockedUntil,
       lockToken = excluded.lockToken,
       attempts = webhook_dedup.attempts + 1
     WHERE webhook_dedup.status != 'PROCESSED'
       AND (webhook_dedup.lockedUntil IS NULL OR webhook_dedup.lockedUntil <= ?)
     RETURNING updateId`,
    updateId, nowIso, leaseUntil, token, nowIso,
  );

  if (claimed.length > 0) return { status: "CLAIMED", token };

  const existing = await first<{ status: string }>(
    "SELECT status FROM webhook_dedup WHERE updateId = ?",
    updateId,
  );
  if (existing?.status === "PROCESSED") return { status: "PROCESSED" };
  if (existing?.status === "PROCESSING") return { status: "BUSY" };
  throw new Error("Could not claim Telegram update.");
}

export async function completeWebhookUpdate(updateId: number, token: string): Promise<void> {
  const now = new Date().toISOString();
  const result = await run(
    `UPDATE webhook_dedup
     SET status = 'PROCESSED', processedAt = ?, lockedUntil = NULL, lockToken = NULL
     WHERE updateId = ? AND status = 'PROCESSING' AND lockToken = ?`,
    now, updateId, token,
  );
  if (result.meta.changes !== 1) {
    throw new Error("Telegram update processing lease was lost before completion.");
  }
}

export async function releaseWebhookUpdate(updateId: number, token: string): Promise<void> {
  await run(
    "DELETE FROM webhook_dedup WHERE updateId = ? AND status = 'PROCESSING' AND lockToken = ?",
    updateId, token,
  );
}
