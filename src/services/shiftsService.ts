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
  const shift = await prisma.shift.create({ data: { ownerId, startAt, name: normalizedName } });
  try {
    const reminders = futureShiftReminderData(ownerId, startAt, timezone, shift.id, normalizedName);
    if (reminders.length) await prisma.reminder.createMany({ data: reminders });
    return shift;
  } catch (error) {
    // D1's Prisma adapter does not provide transactions; compensate if the
    // reminder insert fails so a shift is not left partially configured.
    await prisma.shift.delete({ where: { id: shift.id } }).catch(() => undefined);
    throw error;
  }
}

export async function createShifts(ownerId: number, startAts: Date[], timezone: string, name?: string | null, cycleGroupId?: string | null) {
  const unique = Array.from(new Map(startAts.map((date) => [date.getTime(), date])).values()).sort(
    (a, b) => a.getTime() - b.getTime()
  );
  if (unique.length === 0) throw new Error("Не выбрано ни одной смены.");
  unique.forEach(validateShiftStart);
  const normalizedName = name?.trim() || null;
  const created: Array<{ id: number }> = [];

  try {
    for (const startAt of unique) {
      const shift = await prisma.shift.create({
        data: { ownerId, startAt, name: normalizedName, cycleGroupId: cycleGroupId ?? null },
      });
      created.push({ id: shift.id });
      const reminders = futureShiftReminderData(ownerId, startAt, timezone, shift.id, normalizedName);
      if (reminders.length) await prisma.reminder.createMany({ data: reminders });
    }
    return await prisma.shift.findMany({
      where: { id: { in: created.map((item) => item.id) } },
      orderBy: { startAt: "asc" },
    });
  } catch (error) {
    // Compensating rollback for the shifts created by this operation.
    if (created.length) {
      await prisma.shift.deleteMany({ where: { id: { in: created.map((item) => item.id) } } }).catch(() => undefined);
    }
    throw error;
  }
}

export async function listUpcomingShifts(ownerId: number) {
  return prisma.shift.findMany({
    where: { ownerId, startAt: { gt: new Date() } },
    orderBy: { startAt: "asc" },
    take: 100,
  });
}

export async function cleanupPastShifts() {
  const result = await prisma.shift.deleteMany({
    where: { startAt: { lte: new Date() } },
  });
  return result.count;
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

export async function deleteAllShiftGroups(ownerId: number) {
  const result = await prisma.shift.deleteMany({
    where: { ownerId, cycleGroupId: { not: null }, startAt: { gt: new Date() } },
  });
  return result.count;
}

export async function updateShift(ownerId: number, shiftId: number, startAt: Date, timezone: string, name?: string | null) {
  const shift = await getOwnedShift(ownerId, shiftId);
  if (!shift || shift.startAt <= new Date()) return null;
  validateShiftStart(startAt);
  const normalizedName = name?.trim() || null;
  const activeStatuses = { in: [ReminderStatus.PENDING, ReminderStatus.PROCESSING] };
  const previousReminders = await prisma.reminder.findMany({
    where: { shiftId, status: activeStatuses },
  });

  try {
    await prisma.reminder.deleteMany({ where: { shiftId, status: activeStatuses } });
    const updated = await prisma.shift.update({
      where: { id: shiftId },
      data: { startAt, name: normalizedName },
    });
    const reminders = futureShiftReminderData(ownerId, startAt, timezone, shiftId, normalizedName);
    if (reminders.length) await prisma.reminder.createMany({ data: reminders });
    return updated;
  } catch (error) {
    // D1 does not support interactive transactions. Restore the prior shift
    // and its pending reminders if any part of the update fails.
    await prisma.reminder.deleteMany({ where: { shiftId, status: activeStatuses } }).catch(() => undefined);
    await prisma.shift.update({
      where: { id: shiftId },
      data: { startAt: shift.startAt, name: shift.name },
    }).catch(() => undefined);
    if (previousReminders.length) {
      await prisma.reminder.createMany({
        data: previousReminders.map((reminder) => ({
          id: reminder.id,
          text: reminder.text,
          voiceFileId: reminder.voiceFileId,
          dueAt: reminder.dueAt,
          status: reminder.status,
          processingStartedAt: reminder.processingStartedAt,
          sentAt: reminder.sentAt,
          retryCount: reminder.retryCount,
          lastError: reminder.lastError,
          ownerId: reminder.ownerId,
          shiftId: reminder.shiftId,
          offsetMinutes: reminder.offsetMinutes,
          repeatGroupId: reminder.repeatGroupId,
          repeatRule: reminder.repeatRule,
          createdAt: reminder.createdAt,
          updatedAt: reminder.updatedAt,
        })),
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function updateShiftName(ownerId: number, shiftId: number, name?: string | null, timezone?: string) {
  const shift = await getOwnedShift(ownerId, shiftId);
  if (!shift || shift.startAt <= new Date()) return null;
  const normalizedName = name?.trim() || null;
  const activeReminders = await prisma.reminder.findMany({
    where: { shiftId, status: { in: [ReminderStatus.PENDING, ReminderStatus.PROCESSING] } },
  });

  try {
    const updated = await prisma.shift.update({
      where: { id: shiftId },
      data: { name: normalizedName },
    });
    if (timezone) {
      for (const reminder of activeReminders) {
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { text: buildShiftReminderText(reminder.offsetMinutes ?? 0, shift.startAt, timezone, normalizedName) },
        });
      }
    }
    return updated;
  } catch (error) {
    // Best-effort compensation for D1, which has no Prisma transaction API.
    await prisma.shift.update({ where: { id: shiftId }, data: { name: shift.name } }).catch(() => undefined);
    for (const reminder of activeReminders) {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { text: reminder.text } }).catch(() => undefined);
    }
    throw error;
  }
}

