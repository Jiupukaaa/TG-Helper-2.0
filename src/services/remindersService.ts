import { prisma } from "@/lib/prisma";
import { ReminderStatus } from "@prisma/client";
import { isInPast } from "@/lib/time";
import { ValidationError } from "./notesService";
export { ValidationError };

const MAX_REMINDER_TEXT_LENGTH = 1000;
const STUCK_PROCESSING_MINUTES = 5;
const MAX_RETRIES = 3;
const LEGACY_GROUP_WINDOW_MS = 10 * 60 * 1000;

export function validateReminderText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new ValidationError("Текст напоминания не может быть пустым.");
  if (trimmed.length > MAX_REMINDER_TEXT_LENGTH) throw new ValidationError(`Слишком длинный текст (максимум ${MAX_REMINDER_TEXT_LENGTH} символов).`);
  return trimmed;
}

export function validateDueAt(dueAt: Date): void {
  if (isInPast(dueAt)) throw new ValidationError("Эта дата и время уже в прошлом. Введите другие.");
}

type ReminderCreateOptions = {
  repeatGroupId?: string;
  repeatRule?: "daily" | "weekly" | "monthly";
};

export async function createReminder(ownerId: number, text: string, dueAt: Date, voiceFileId?: string, options?: ReminderCreateOptions) {
  const validatedText = validateReminderText(text);
  validateDueAt(dueAt);
  return prisma.reminder.create({
    data: {
      ownerId,
      text: validatedText,
      dueAt,
      voiceFileId,
      repeatGroupId: options?.repeatGroupId,
      repeatRule: options?.repeatRule,
    },
  });
}

function legacyRepeatRule(previous: Date, current: Date): "daily" | "weekly" | null {
  const diffHours = (current.getTime() - previous.getTime()) / 3600000;
  if (Math.abs(diffHours - 24) < 0.01) return "daily";
  if (Math.abs(diffHours - 168) < 0.01) return "weekly";
  return null;
}

function groupLegacyRecurringReminders<T extends {
  id: number;
  ownerId: number;
  text: string;
  voiceFileId: string | null;
  dueAt: Date;
  createdAt: Date;
  repeatGroupId: string | null;
  repeatRule: string | null;
}>(reminders: T[]): T[] {
  const result = [...reminders];
  const candidates = result.filter((reminder) => !reminder.repeatGroupId);
  const processed = new Set<number>();

  for (const seed of candidates) {
    if (processed.has(seed.id)) continue;

    const group = candidates.filter((item) =>
      !processed.has(item.id) &&
      item.ownerId === seed.ownerId &&
      item.text === seed.text &&
      item.voiceFileId === seed.voiceFileId &&
      Math.abs(item.createdAt.getTime() - seed.createdAt.getTime()) <= LEGACY_GROUP_WINDOW_MS,
    ).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

    if (group.length < 2) continue;

    let rule: "daily" | "weekly" | null = null;
    let valid = true;
    for (let i = 1; i < group.length; i += 1) {
      const detected = legacyRepeatRule(group[i - 1]!.dueAt, group[i]!.dueAt);
      if (!detected) { valid = false; break; }
      if (rule && rule !== detected) { valid = false; break; }
      rule = detected;
    }

    if (!valid || !rule) continue;

    const virtualGroupId = `legacy-${seed.id}`;
    for (const item of group) {
      const index = result.findIndex((reminder) => reminder.id === item.id);
      if (index !== -1) {
        result[index] = { ...result[index]!, repeatGroupId: virtualGroupId, repeatRule: rule };
        processed.add(item.id);
      }
    }
  }

  return result;
}

export async function listReminders(ownerId: number) {
  const reminders = await prisma.reminder.findMany({
    where: { ownerId, shiftId: null, status: { in: [ReminderStatus.PENDING, ReminderStatus.PROCESSING] } },
    orderBy: { dueAt: "asc" },
  });
  return groupLegacyRecurringReminders(reminders);
}

export async function getOwnedReminder(ownerId: number, reminderId: number) {
  return prisma.reminder.findFirst({ where: { id: reminderId, ownerId, shiftId: null } });
}

export async function deleteReminder(ownerId: number, reminderId: number) {
  const existing = await getOwnedReminder(ownerId, reminderId);
  if (!existing) return null;
  return prisma.reminder.delete({ where: { id: reminderId } });
}

export async function getReminderGroup(ownerId: number, reminderId: number) {
  const existing = await getOwnedReminder(ownerId, reminderId);
  if (!existing) return [];
  if (!existing.repeatGroupId) return [existing];
  return prisma.reminder.findMany({
    where: {
      ownerId,
      repeatGroupId: existing.repeatGroupId,
      shiftId: null,
      status: { in: [ReminderStatus.PENDING, ReminderStatus.PROCESSING] },
    },
    orderBy: { dueAt: "asc" },
  });
}

export async function deleteReminderGroup(ownerId: number, reminderId: number) {
  const existing = await getOwnedReminder(ownerId, reminderId);
  if (!existing) return 0;
  if (!existing.repeatGroupId) {
    const deleted = await prisma.reminder.delete({ where: { id: existing.id } });
    return deleted ? 1 : 0;
  }
  const result = await prisma.reminder.deleteMany({
    where: { ownerId, repeatGroupId: existing.repeatGroupId, shiftId: null },
  });
  return result.count;
}

export async function updateReminderGroup(
  ownerId: number,
  reminderId: number,
  changes: { text?: string; dueAt?: Date },
) {
  const group = await getReminderGroup(ownerId, reminderId);
  if (!group.length) return 0;

  if (changes.text !== undefined) {
    const text = validateReminderText(changes.text);
    const result = await prisma.reminder.updateMany({
      where: { ownerId, repeatGroupId: group[0]!.repeatGroupId ?? undefined, id: group[0]!.repeatGroupId ? undefined : group[0]!.id },
      data: { text },
    });
    return result.count;
  }

  if (changes.dueAt !== undefined) {
    validateDueAt(changes.dueAt);
    const first = group[0]!;
    const delta = changes.dueAt.getTime() - first.dueAt.getTime();
    let count = 0;
    for (const reminder of group) {
      const dueAt = new Date(reminder.dueAt.getTime() + delta);
      validateDueAt(dueAt);
      await prisma.reminder.update({ where: { id: reminder.id }, data: { dueAt } });
      count += 1;
    }
    return count;
  }

  return 0;
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
