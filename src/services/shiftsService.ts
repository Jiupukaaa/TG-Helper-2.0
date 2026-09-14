import { prisma } from "@/lib/prisma";
import { ReminderStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { isInPast } from "@/lib/time";

export const SHIFT_REMINDER_OFFSETS = [-360, -240, -120, 0] as const;

export function buildShiftReminderText(offsetMinutes: number, startAt: Date, timezone: string, name?: string | null): string {
  const local = DateTime.fromJSDate(startAt, { zone: "utc" }).setZone(timezone).toFormat("dd.MM.yyyy HH:mm");
  const title = name?.trim() ? ` — ${name.trim()}` : "";
  switch (offsetMinutes) {
    case -360:
      return `📅 Смена${title} ${local}\nДо начала 6 часов.`;
    case -240:
      return `📅 Смена${title} ${local}\nДо начала 4 часа.`;
    case -120:
      return `📅 Смена${title} ${local}\nДо начала 2 часа.`;
    case 0:
      return `🟢 Смена${title} начинается сейчас\n${local}`;
    default:
      return `📅 Смена${title} ${local}`;
  }
}

export function validateShiftStart(startAt: Date): void {
  if (isInPast(startAt)) {
    throw new Error("Нельзя создать смену, которая уже началась.");
  }
}

function futureShiftReminderData(ownerId: number, startAt: Date, timezone: string, shiftId: number, name?: string | null) {
  const now = Date.now();
  return SHIFT_REMINDER_OFFSETS
    .map((offsetMinutes) => ({
      ownerId,
      shiftId,
      offsetMinutes,
      dueAt: new Date(startAt.getTime() + offsetMinutes * 60_000),
      text: buildShiftReminderText(offsetMinutes, startAt, timezone, name),
    }))
    .filter((reminder) => reminder.dueAt.getTime() > now);
}

export async function createShift(ownerId: number, startAt: Date, timezone: string, name?: string | null) {
  validateShiftStart(startAt);
  const normalizedName = name?.trim() || null;
  return prisma.$transaction(async (tx) => {
    const shift = await tx.shift.create({ data: { ownerId, startAt, name: normalizedName } });
    const reminders = futureShiftReminderData(ownerId, startAt, timezone, shift.id, normalizedName);
    if (reminders.length) await tx.reminder.createMany({ data: reminders });
    return shift;
  });
}

export async function createShifts(ownerId: number, startAts: Date[], timezone: string, name?: string | null, cycleGroupId?: string | null) {
  const unique = Array.from(new Map(startAts.map((date) => [date.getTime(), date])).values()).sort(
    (a, b) => a.getTime() - b.getTime()
  );
  if (unique.length === 0) throw new Error("Не выбрано ни одной смены.");
  unique.forEach(validateShiftStart);
  const normalizedName = name?.trim() || null;

  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const startAt of unique) {
      const shift = await tx.shift.create({ data: { ownerId, startAt, name: normalizedName, cycleGroupId: cycleGroupId ?? null } });
      const reminders = futureShiftReminderData(ownerId, startAt, timezone, shift.id, normalizedName);
      if (reminders.length) await tx.reminder.createMany({ data: reminders });
      created.push(shift);
    }
    return created;
  });
}

export async function listUpcomingShifts(ownerId: number) {
  return prisma.shift.findMany({
    where: { ownerId, startAt: { gt: new Date() } },
    orderBy: { startAt: "asc" },
    take: 100,
  });
}

export async function getOwnedShift(ownerId: number, shiftId: number) {
  return prisma.shift.findFirst({ where: { id: shiftId, ownerId } });
}

export async function deleteShift(ownerId: number, shiftId: number) {
  const shift = await getOwnedShift(ownerId, shiftId);
  if (!shift || shift.startAt <= new Date()) return false;
  await prisma.shift.delete({ where: { id: shiftId } });
  return true;
}

export async function deleteShiftGroup(ownerId: number, cycleGroupId: string) {
  const result = await prisma.shift.deleteMany({
    where: { ownerId, cycleGroupId, startAt: { gt: new Date() } },
  });
  return result.count;
}

export async function updateShift(ownerId: number, shiftId: number, startAt: Date, timezone: string, name?: string | null) {
  const shift = await getOwnedShift(ownerId, shiftId);
  if (!shift || shift.startAt <= new Date()) return null;
  validateShiftStart(startAt);
  const normalizedName = name?.trim() || null;

  return prisma.$transaction(async (tx) => {
    await tx.reminder.deleteMany({
      where: { shiftId, status: { in: [ReminderStatus.PENDING, ReminderStatus.PROCESSING] } },
    });
    const updated = await tx.shift.update({ where: { id: shiftId }, data: { startAt, name: normalizedName } });
    const reminders = futureShiftReminderData(ownerId, startAt, timezone, shiftId, normalizedName);
    if (reminders.length) await tx.reminder.createMany({ data: reminders });
    return updated;
  });
}

export async function updateShiftName(ownerId: number, shiftId: number, name?: string | null, timezone?: string) {
  const shift = await getOwnedShift(ownerId, shiftId);
  if (!shift || shift.startAt <= new Date()) return null;
  const normalizedName = name?.trim() || null;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.shift.update({ where: { id: shiftId }, data: { name: normalizedName } });
    if (timezone) {
      const reminders = await tx.reminder.findMany({ where: { shiftId, status: { in: [ReminderStatus.PENDING, ReminderStatus.PROCESSING] } } });
      for (const reminder of reminders) {
        await tx.reminder.update({ where: { id: reminder.id }, data: { text: buildShiftReminderText(reminder.offsetMinutes ?? 0, shift.startAt, timezone, normalizedName) } });
      }
    }
    return updated;
  });
}
