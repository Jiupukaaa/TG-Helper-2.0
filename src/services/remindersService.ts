import { prisma } from "@/lib/prisma";
import { ReminderStatus } from "@prisma/client";
import { isInPast } from "@/lib/time";
import { ValidationError } from "./notesService";
export { ValidationError };

const MAX_REMINDER_TEXT_LENGTH = 1000;
const STUCK_PROCESSING_MINUTES = 5;
const MAX_RETRIES = 3;

export function validateReminderText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new ValidationError("Текст напоминания не может быть пустым.");
  if (trimmed.length > MAX_REMINDER_TEXT_LENGTH) throw new ValidationError(`Слишком длинный текст (максимум ${MAX_REMINDER_TEXT_LENGTH} символов).`);
  return trimmed;
}

export function validateDueAt(dueAt: Date): void {
  if (isInPast(dueAt)) throw new ValidationError("Эта дата и время уже в прошлом. Введите другие.");
}

export async function createReminder(ownerId: number, text: string, dueAt: Date, voiceFileId?: string) {
  const validatedText = validateReminderText(text);
  validateDueAt(dueAt);
  return prisma.reminder.create({ data: { ownerId, text: validatedText, dueAt, voiceFileId } });
}

export async function listReminders(ownerId: number) {
  return prisma.reminder.findMany({
    where: { ownerId, shiftId: null, status: { in: [ReminderStatus.PENDING, ReminderStatus.PROCESSING] } },
    orderBy: { dueAt: "asc" },
  });
}

export async function getOwnedReminder(ownerId: number, reminderId: number) {
  return prisma.reminder.findFirst({ where: { id: reminderId, ownerId, shiftId: null } });
}

export async function deleteReminder(ownerId: number, reminderId: number) {
  const existing = await getOwnedReminder(ownerId, reminderId);
  if (!existing) return null;
  return prisma.reminder.delete({ where: { id: reminderId } });
}

export async function claimDueReminders(limit = 50) {
  const stuckThreshold = new Date(Date.now() - STUCK_PROCESSING_MINUTES * 60 * 1000);
  const claimed = await prisma.$queryRaw<{ id: number }[]>`
    WITH candidates AS (
      SELECT id FROM "reminders"
      WHERE (status = 'PENDING' AND "dueAt" <= now())
         OR (status = 'PROCESSING' AND "processingStartedAt" < ${stuckThreshold})
      ORDER BY "dueAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "reminders"
    SET status = 'PROCESSING', "processingStartedAt" = now()
    WHERE id IN (SELECT id FROM candidates)
    RETURNING id
  `;
  if (claimed.length === 0) return [];
  return prisma.reminder.findMany({ where: { id: { in: claimed.map((c) => c.id) } }, include: { owner: true } });
}

export async function markReminderSent(reminderId: number) {
  await prisma.reminder.update({ where: { id: reminderId }, data: { status: ReminderStatus.SENT, sentAt: new Date(), lastError: null } });
}

export async function markReminderFailed(reminderId: number, errorMessage: string, permanent: boolean) {
  const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
  if (!reminder) return;
  const nextRetryCount = reminder.retryCount + 1;
  const exhausted = nextRetryCount >= MAX_RETRIES;
  await prisma.reminder.update({
    where: { id: reminderId },
    data: { status: permanent || exhausted ? ReminderStatus.FAILED : ReminderStatus.PENDING, retryCount: nextRetryCount, lastError: errorMessage.slice(0, 500) },
  });
}
