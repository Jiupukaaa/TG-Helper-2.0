import { prisma } from "@/lib/prisma";
import { ReminderStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { isInPast } from "@/lib/time";

export const SHIFT_REMINDER_OFFSETS = [-360, -240, -120, 0] as const;

export function buildShiftReminderText(offsetMinutes: number, startAt: Date, timezone: string): string {
  const local = DateTime.fromJSDate(startAt, { zone: "utc" }).setZone(timezone).toFormat("dd.MM.yyyy HH:mm");
  switch (offsetMinutes) {
    case -360:
      return `📅 Смена ${local}\nДо начала 6 часов.`;
    case -240:
      return `📅 Смена ${local}\nДо начала 4 часа.`;
    case -120:
      return `📅 Смена ${local}\nДо начала 2 часа.`;
    case 0:
      return `🟢 Смена начинается сейчас\n${local}`;
    default:
      return `📅 Смена ${local}`;
  }
}

export function validateShiftStart(startAt: Date): void {
  if (isInPast(startAt)) {
    throw new Error("Нельзя создать смену, которая уже началась.");
  }
}

export async function createShift(ownerId: number, startAt: Date, timezone: string) {
  validateShiftStart(startAt);
  return prisma.$transaction(async (tx) => {
    const shift = await tx.shift.create({ data: { ownerId, startAt } });
    await tx.reminder.createMany({
      data: SHIFT_REMINDER_OFFSETS.map((offsetMinutes) => ({
        ownerId,
        shiftId: shift.id,
        offsetMinutes,
        dueAt: new Date(startAt.getTime() + offsetMinutes * 60_000),
        text: buildShiftReminderText(offsetMinutes, startAt, timezone),
      })),
    });
    return shift;
  });
}

export async function createShifts(ownerId: number, startAts: Date[], timezone: string) {
  const unique = Array.from(new Map(startAts.map((date) => [date.getTime(), date])).values()).sort(
    (a, b) => a.getTime() - b.getTime()
  );
  if (unique.length === 0) throw new Error("Не выбрано ни одной смены.");
  unique.forEach(validateShiftStart);

  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const startAt of unique) {
      const shift = await tx.shift.create({ data: { ownerId, startAt } });
      await tx.reminder.createMany({
        data: SHIFT_REMINDER_OFFSETS.map((offsetMinutes) => ({
          ownerId,
          shiftId: shift.id,
          offsetMinutes,
          dueAt: new Date(startAt.getTime() + offsetMinutes * 60_000),
          text: buildShiftReminderText(offsetMinutes, startAt, timezone),
        })),
      });
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

export async function updateShift(ownerId: number, shiftId: number, startAt: Date, timezone: string) {
  const shift = await getOwnedShift(ownerId, shiftId);
  if (!shift || shift.startAt <= new Date()) return null;
  validateShiftStart(startAt);

  return prisma.$transaction(async (tx) => {
    await tx.reminder.deleteMany({
      where: { shiftId, status: { in: [ReminderStatus.PENDING, ReminderStatus.PROCESSING] } },
    });
    const updated = await tx.shift.update({ where: { id: shiftId }, data: { startAt } });
    await tx.reminder.createMany({
      data: SHIFT_REMINDER_OFFSETS.map((offsetMinutes) => ({
        ownerId,
        shiftId,
        offsetMinutes,
        dueAt: new Date(startAt.getTime() + offsetMinutes * 60_000),
        text: buildShiftReminderText(offsetMinutes, startAt, timezone),
      })),
    });
    return updated;
  });
}
