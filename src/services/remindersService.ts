import { all, batch, first, run, statement } from "@/db/client";
import { ReminderStatus, type Reminder, type User } from "@/db/types";
import { isInPast } from "@/lib/time";
import { ValidationError } from "./notesService";
export { ValidationError };

const MAX_REMINDER_TEXT_LENGTH = 1000;
const STUCK_PROCESSING_MINUTES = 5;
const MAX_RETRIES = 3;
const LEGACY_GROUP_WINDOW_MS = 10 * 60 * 1000;

type ReminderRow = Omit<Reminder, "dueAt" | "processingStartedAt" | "sentAt" | "createdAt" | "updatedAt"> & {
  dueAt: string;
  processingStartedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type ReminderWithOwnerRow = ReminderRow & {
  owner_id: number;
  owner_telegramId: number;
  owner_timezone: string;
  owner_createdAt: string;
  owner_updatedAt: string;
};

function mapReminder(row: ReminderRow): Reminder {
  return {
    ...row,
    dueAt: new Date(row.dueAt),
    processingStartedAt: row.processingStartedAt ? new Date(row.processingStartedAt) : null,
    sentAt: row.sentAt ? new Date(row.sentAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function mapReminderWithOwner(row: ReminderWithOwnerRow): Reminder & { owner: User } {
  const { owner_id, owner_telegramId, owner_timezone, owner_createdAt, owner_updatedAt, ...reminderRow } = row;
  return {
    ...mapReminder(reminderRow),
    owner: {
      id: owner_id,
      telegramId: owner_telegramId,
      timezone: owner_timezone,
      createdAt: new Date(owner_createdAt),
      updatedAt: new Date(owner_updatedAt),
    },
  };
}

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

export async function createReminder(ownerId: number, text: string, dueAt: Date, voiceFileId?: string, options?: ReminderCreateOptions): Promise<Reminder> {
  const validatedText = validateReminderText(text);
  validateDueAt(dueAt);
  const now = new Date().toISOString();
  const rows = await all<ReminderRow>(
    `INSERT INTO reminders (text, voiceFileId, dueAt, ownerId, repeatGroupId, repeatRule, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    validatedText, voiceFileId ?? null, dueAt.toISOString(), ownerId,
    options?.repeatGroupId ?? null, options?.repeatRule ?? null, now, now,
  );
  if (!rows[0]) throw new Error("Не удалось создать напоминание.");
  return mapReminder(rows[0]);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
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
      if (!detected || (rule && rule !== detected)) { valid = false; break; }
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

export async function listReminders(ownerId: number): Promise<Reminder[]> {
  const rows = await all<ReminderRow>(
    "SELECT * FROM reminders WHERE ownerId = ? AND shiftId IS NULL AND status IN (?, ?) ORDER BY dueAt ASC",
    ownerId, ReminderStatus.PENDING, ReminderStatus.PROCESSING,
  );
  return groupLegacyRecurringReminders(rows.map(mapReminder));
}

export async function getOwnedReminder(ownerId: number, reminderId: number): Promise<Reminder | null> {
  const row = await first<ReminderRow>(
    "SELECT * FROM reminders WHERE id = ? AND ownerId = ? AND shiftId IS NULL",
    reminderId, ownerId,
  );
  return row ? mapReminder(row) : null;
}

export async function deleteReminder(ownerId: number, reminderId: number): Promise<Reminder | null> {
  const rows = await all<ReminderRow>(
    "DELETE FROM reminders WHERE id = ? AND ownerId = ? AND shiftId IS NULL RETURNING *",
    reminderId, ownerId,
  );
  return rows[0] ? mapReminder(rows[0]) : null;
}

async function getActiveReminders(ownerId: number): Promise<Reminder[]> {
  const rows = await all<ReminderRow>(
    "SELECT * FROM reminders WHERE ownerId = ? AND shiftId IS NULL AND status IN (?, ?) ORDER BY dueAt ASC",
    ownerId, ReminderStatus.PENDING, ReminderStatus.PROCESSING,
  );
  return groupLegacyRecurringReminders(rows.map(mapReminder));
}

export async function getReminderGroup(ownerId: number, reminderId: number): Promise<Reminder[]> {
  const existing = await getOwnedReminder(ownerId, reminderId);
  if (!existing) return [];
  if (existing.repeatGroupId) {
    const rows = await all<ReminderRow>(
      "SELECT * FROM reminders WHERE ownerId = ? AND repeatGroupId = ? AND shiftId IS NULL AND status IN (?, ?) ORDER BY dueAt ASC",
      ownerId, existing.repeatGroupId, ReminderStatus.PENDING, ReminderStatus.PROCESSING,
    );
    return rows.map(mapReminder);
  }
  const active = await getActiveReminders(ownerId);
  const grouped = active.find((item) => item.id === reminderId);
  if (!grouped?.repeatGroupId) return [existing];
  return active.filter((item) => item.repeatGroupId === grouped.repeatGroupId);
}

export async function deleteReminderGroup(ownerId: number, reminderId: number): Promise<number> {
  const group = await getReminderGroup(ownerId, reminderId);
  if (!group.length) return 0;
  const statements = chunks(group, 99).map((items) => {
    const placeholders = items.map(() => "?").join(", ");
    return statement(
      `DELETE FROM reminders WHERE ownerId = ? AND shiftId IS NULL AND id IN (${placeholders})`,
      ownerId, ...items.map((item) => item.id),
    );
  });
  const results = await batch(statements);
  return results.reduce((count, result) => count + result.meta.changes, 0);
}

export async function updateReminderGroup(
  ownerId: number,
  reminderId: number,
  changes: { text?: string; dueAt?: Date },
): Promise<number> {
  const group = await getReminderGroup(ownerId, reminderId);
  if (!group.length) return 0;
  const placeholders = group.map(() => "?").join(", ");

  if (changes.text !== undefined) {
    const text = validateReminderText(changes.text);
    const now = new Date().toISOString();
    const statements = chunks(group, 97).map((items) => {
      const ids = items.map(() => "?").join(", ");
      return statement(
        `UPDATE reminders SET text = ?, updatedAt = ? WHERE ownerId = ? AND shiftId IS NULL AND id IN (${ids})`,
        text, now, ownerId, ...items.map((item) => item.id),
      );
    });
    const results = await batch(statements);
    return results.reduce((count, result) => count + result.meta.changes, 0);
  }

  if (changes.dueAt !== undefined) {
    validateDueAt(changes.dueAt);
    const firstReminder = group[0]!;
    const delta = changes.dueAt.getTime() - firstReminder.dueAt.getTime();
    const now = new Date().toISOString();
    const statements = group.map((reminder) => {
      const dueAt = new Date(reminder.dueAt.getTime() + delta);
      validateDueAt(dueAt);
      return statement(
        "UPDATE reminders SET dueAt = ?, updatedAt = ? WHERE id = ? AND ownerId = ? AND shiftId IS NULL",
        dueAt.toISOString(), now, reminder.id, ownerId,
      );
    });
    const results = await batch(statements);
    return results.reduce((count, result) => count + result.meta.changes, 0);
  }
  return 0;
}

export async function claimDueReminders(limit = 50): Promise<Array<Reminder & { owner: User }>> {
  const now = new Date();
  const nowIso = now.toISOString();
  const stuckThreshold = new Date(now.getTime() - STUCK_PROCESSING_MINUTES * 60 * 1000).toISOString();
  const claimedRows = await all<{ id: number }>(
    `UPDATE reminders
     SET status = ?, processingStartedAt = ?, updatedAt = ?
     WHERE id IN (
       SELECT id FROM reminders
       WHERE (status = ? AND dueAt <= ?)
          OR (status = ? AND processingStartedAt < ?)
       ORDER BY dueAt ASC
       LIMIT ?
     )
     RETURNING id`,
    ReminderStatus.PROCESSING, nowIso, nowIso,
    ReminderStatus.PENDING, nowIso,
    ReminderStatus.PROCESSING, stuckThreshold,
    limit,
  );
  if (!claimedRows.length) return [];
  const placeholders = claimedRows.map(() => "?").join(", ");
  const rows = await all<ReminderWithOwnerRow>(
    `SELECT r.*, u.id AS owner_id, u.telegramId AS owner_telegramId, u.timezone AS owner_timezone,
            u.createdAt AS owner_createdAt, u.updatedAt AS owner_updatedAt
     FROM reminders r JOIN users u ON u.id = r.ownerId
     WHERE r.id IN (${placeholders}) ORDER BY r.dueAt ASC`,
    ...claimedRows.map((row) => row.id),
  );
  return rows.map(mapReminderWithOwner);
}

export async function markReminderSent(reminderId: number): Promise<void> {
  const now = new Date().toISOString();
  await run(
    "UPDATE reminders SET status = ?, sentAt = ?, lastError = NULL, updatedAt = ? WHERE id = ?",
    ReminderStatus.SENT, now, now, reminderId,
  );
}

export async function markReminderFailed(reminderId: number, errorMessage: string, permanent: boolean): Promise<void> {
  const reminder = await first<{ retryCount: number }>("SELECT retryCount FROM reminders WHERE id = ?", reminderId);
  if (!reminder) return;
  const nextRetryCount = reminder.retryCount + 1;
  const exhausted = nextRetryCount >= MAX_RETRIES;
  const status = permanent || exhausted ? ReminderStatus.FAILED : ReminderStatus.PENDING;
  await run(
    "UPDATE reminders SET status = ?, retryCount = ?, lastError = ?, updatedAt = ? WHERE id = ?",
    status, nextRetryCount, errorMessage.slice(0, 500), new Date().toISOString(), reminderId,
  );
}
