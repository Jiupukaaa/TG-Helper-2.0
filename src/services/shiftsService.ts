import { all, batch, first, run, statement } from "@/db/client";
import { ReminderStatus, type Reminder, type Shift } from "@/db/types";
import { DateTime } from "luxon";
import { isInPast } from "@/lib/time";

export const SHIFT_REMINDER_OFFSETS = [-360, -240, -120, 0] as const;

type ShiftRow = Omit<Shift, "startAt" | "createdAt" | "updatedAt"> & {
  startAt: string;
  createdAt: string;
  updatedAt: string;
};
type ShiftReminderRow = Omit<Reminder, "dueAt" | "processingStartedAt" | "sentAt" | "createdAt" | "updatedAt"> & {
  dueAt: string;
  processingStartedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapShift(row: ShiftRow): Shift {
  return { ...row, startAt: new Date(row.startAt), createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

function mapReminder(row: ShiftReminderRow): Reminder {
  return {
    ...row,
    dueAt: new Date(row.dueAt),
    processingStartedAt: row.processingStartedAt ? new Date(row.processingStartedAt) : null,
    sentAt: row.sentAt ? new Date(row.sentAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export function buildShiftReminderText(offsetMinutes: number, startAt: Date, timezone: string, name?: string | null): string {
  const local = DateTime.fromJSDate(startAt, { zone: "utc" }).setZone(timezone).toFormat("dd.MM.yyyy HH:mm");
  const title = name?.trim() ? ` — ${name.trim()}` : "";
  switch (offsetMinutes) {
    case -360: return `📅 Смена${title} ${local}\nДо начала 6 часов.`;
    case -240: return `📅 Смена${title} ${local}\nДо начала 4 часа.`;
    case -120: return `📅 Смена${title} ${local}\nДо начала 2 часа.`;
    case 0: return `🟢 Смена${title} начинается сейчас\n${local}`;
    default: return `📅 Смена${title} ${local}`;
  }
}

export function validateShiftStart(startAt: Date): void {
  if (isInPast(startAt)) throw new Error("Нельзя создать смену, которая уже началась.");
}

function futureShiftReminderData(ownerId: number, startAt: Date, timezone: string, name?: string | null) {
  const now = Date.now();
  return SHIFT_REMINDER_OFFSETS.map((offsetMinutes) => ({
    ownerId,
    startAt: startAt.toISOString(),
    offsetMinutes,
    dueAt: new Date(startAt.getTime() + offsetMinutes * 60_000),
    text: buildShiftReminderText(offsetMinutes, startAt, timezone, name),
  })).filter((reminder) => reminder.dueAt.getTime() > now);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function createShiftsAtomic(
  ownerId: number,
  startAts: Date[],
  timezone: string,
  name: string | null,
  cycleGroupId: string | null,
): Promise<Shift[]> {
  const now = new Date().toISOString();
  const statements = startAts.map((startAt) => statement(
    "INSERT INTO shifts (name, startAt, ownerId, cycleGroupId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
    name, startAt.toISOString(), ownerId, cycleGroupId, now, now,
  ));

  const reminderRows = startAts.flatMap((startAt) =>
    futureShiftReminderData(ownerId, startAt, timezone, name).map((reminder) => ({
      ...reminder,
      createdAt: now,
      updatedAt: now,
    })),
  );

  // D1 limits SQL statement size; each chunk is kept well below the 100 KB limit.
  for (const group of chunks(reminderRows, 14)) {
    const values = group.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params = group.flatMap((reminder) => [
      reminder.text, reminder.dueAt.toISOString(), reminder.ownerId, reminder.offsetMinutes,
      reminder.createdAt, reminder.updatedAt, reminder.startAt,
    ]);
    statements.push(statement(
      `WITH reminder_data(text, dueAt, ownerId, offsetMinutes, createdAt, updatedAt, startAt)
       AS (VALUES ${values})
       INSERT INTO reminders (text, dueAt, status, ownerId, shiftId, offsetMinutes, createdAt, updatedAt)
       SELECT d.text, d.dueAt, 'PENDING', d.ownerId, s.id, d.offsetMinutes, d.createdAt, d.updatedAt
       FROM reminder_data d
       JOIN shifts s ON s.ownerId = d.ownerId AND s.startAt = d.startAt`,
      ...params,
    ));
  }

  await batch(statements);
  const rows: ShiftRow[] = [];
  for (const group of chunks(startAts, 99)) {
    const placeholders = group.map(() => "?").join(", ");
    rows.push(...await all<ShiftRow>(
      `SELECT * FROM shifts WHERE ownerId = ? AND startAt IN (${placeholders}) ORDER BY startAt ASC`,
      ownerId, ...group.map((startAt) => startAt.toISOString()),
    ));
  }
  return rows.map(mapShift).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export async function createShift(ownerId: number, startAt: Date, timezone: string, name?: string | null): Promise<Shift> {
  validateShiftStart(startAt);
  const created = await createShiftsAtomic(ownerId, [startAt], timezone, name?.trim() || null, null);
  if (!created[0]) throw new Error("Не удалось создать смену.");
  return created[0];
}

export async function createShifts(ownerId: number, startAts: Date[], timezone: string, name?: string | null, cycleGroupId?: string | null): Promise<Shift[]> {
  const unique = Array.from(new Map(startAts.map((value) => [value.getTime(), value])).values())
    .sort((a, b) => a.getTime() - b.getTime());
  if (!unique.length) throw new Error("Не выбрано ни одной смены.");
  unique.forEach(validateShiftStart);
  return createShiftsAtomic(ownerId, unique, timezone, name?.trim() || null, cycleGroupId ?? null);
}

export async function listShiftsInRange(ownerId: number, startAt: Date, endAt: Date): Promise<Shift[]> {
  const rows = await all<ShiftRow>(
    "SELECT * FROM shifts WHERE ownerId = ? AND startAt >= ? AND startAt < ? ORDER BY startAt ASC",
    ownerId, startAt.toISOString(), endAt.toISOString(),
  );
  return rows.map(mapShift);
}

export async function listUpcomingShifts(ownerId: number): Promise<Shift[]> {
  const rows = await all<ShiftRow>(
    "SELECT * FROM shifts WHERE ownerId = ? AND startAt > ? ORDER BY startAt ASC LIMIT 100",
    ownerId, new Date().toISOString(),
  );
  return rows.map(mapShift);
}

export async function listUpcomingShiftsInGroup(ownerId: number, cycleGroupId: string): Promise<Shift[]> {
  const rows = await all<ShiftRow>(
    "SELECT * FROM shifts WHERE ownerId = ? AND cycleGroupId = ? AND startAt > ? ORDER BY startAt ASC LIMIT 100",
    ownerId, cycleGroupId, new Date().toISOString(),
  );
  return rows.map(mapShift);
}

export async function cleanupPastShifts(): Promise<number> {
  const result = await run("DELETE FROM shifts WHERE startAt <= ?", new Date().toISOString());
  return result.meta.changes;
}

export async function getOwnedShift(ownerId: number, shiftId: number): Promise<Shift | null> {
  const row = await first<ShiftRow>("SELECT * FROM shifts WHERE id = ? AND ownerId = ?", shiftId, ownerId);
  return row ? mapShift(row) : null;
}

export async function deleteShift(ownerId: number, shiftId: number): Promise<boolean> {
  const rows = await all<{ id: number }>(
    "DELETE FROM shifts WHERE id = ? AND ownerId = ? AND startAt > ? RETURNING id",
    shiftId, ownerId, new Date().toISOString(),
  );
  return rows.length > 0;
}

export async function deleteShiftGroup(ownerId: number, cycleGroupId: string): Promise<number> {
  const result = await run(
    "DELETE FROM shifts WHERE ownerId = ? AND cycleGroupId = ? AND startAt > ?",
    ownerId, cycleGroupId, new Date().toISOString(),
  );
  return result.meta.changes;
}

export async function deleteAllShiftGroups(ownerId: number): Promise<number> {
  const result = await run(
    "DELETE FROM shifts WHERE ownerId = ? AND cycleGroupId IS NOT NULL AND startAt > ?",
    ownerId, new Date().toISOString(),
  );
  return result.meta.changes;
}

export async function updateShift(ownerId: number, shiftId: number, startAt: Date, timezone: string, name?: string | null): Promise<Shift | null> {
  const shift = await getOwnedShift(ownerId, shiftId);
  if (!shift || shift.startAt <= new Date()) return null;
  validateShiftStart(startAt);
  const normalizedName = name?.trim() || null;
  const now = new Date().toISOString();
  const reminders = futureShiftReminderData(ownerId, startAt, timezone, normalizedName);
  const statements = [
    statement(
      "DELETE FROM reminders WHERE shiftId = ? AND status IN (?, ?)",
      shiftId, ReminderStatus.PENDING, ReminderStatus.PROCESSING,
    ),
    statement(
      "UPDATE shifts SET startAt = ?, name = ?, updatedAt = ? WHERE id = ? AND ownerId = ?",
      startAt.toISOString(), normalizedName, now, shiftId, ownerId,
    ),
    ...reminders.map((reminder) => statement(
      `INSERT INTO reminders (text, dueAt, status, ownerId, shiftId, offsetMinutes, createdAt, updatedAt)
       VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?)`,
      reminder.text, reminder.dueAt.toISOString(), ownerId, shiftId, reminder.offsetMinutes, now, now,
    )),
  ];
  await batch(statements);
  return getOwnedShift(ownerId, shiftId);
}

export async function updateShiftName(ownerId: number, shiftId: number, name?: string | null, timezone?: string): Promise<Shift | null> {
  const shift = await getOwnedShift(ownerId, shiftId);
  if (!shift || shift.startAt <= new Date()) return null;
  const normalizedName = name?.trim() || null;
  const now = new Date().toISOString();
  const statements = [
    statement("UPDATE shifts SET name = ?, updatedAt = ? WHERE id = ? AND ownerId = ?", normalizedName, now, shiftId, ownerId),
  ];
  if (timezone) {
    const rows = await all<ShiftReminderRow>(
      "SELECT * FROM reminders WHERE shiftId = ? AND status IN (?, ?)",
      shiftId, ReminderStatus.PENDING, ReminderStatus.PROCESSING,
    );
    for (const row of rows.map(mapReminder)) {
      statements.push(statement(
        "UPDATE reminders SET text = ?, updatedAt = ? WHERE id = ?",
        buildShiftReminderText(row.offsetMinutes ?? 0, shift.startAt, timezone, normalizedName), now, row.id,
      ));
    }
  }
  await batch(statements);
  return getOwnedShift(ownerId, shiftId);
}
