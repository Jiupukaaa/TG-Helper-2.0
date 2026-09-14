import { prisma } from "@/lib/prisma";
import { SessionStep, type User } from "@prisma/client";

export type ReminderDraft = { text?: string; voiceFileId?: string };
export type NoteEditDraft = { noteId?: number };
export type ShiftDraft = { dates?: string[]; calendarMonth?: string; time?: string; workDays?: number; offDays?: number; firstDate?: string; editShiftId?: number; pendingStarts?: string[] };
export type SessionDraft = ReminderDraft & NoteEditDraft & ShiftDraft;

export async function getOrCreateUser(telegramId: bigint): Promise<User> {
  return prisma.user.upsert({ where: { telegramId }, update: {}, create: { telegramId } });
}
export async function setSessionStep(userId: number, step: SessionStep, draft: SessionDraft = {}): Promise<void> {
  await prisma.session.upsert({ where: { userId }, update: { step, draft }, create: { userId, step, draft } });
}
export async function getSession(userId: number) { return prisma.session.findUnique({ where: { userId } }); }
export async function clearSession(userId: number): Promise<void> { await prisma.session.upsert({ where: { userId }, update: { step: SessionStep.IDLE, draft: {} }, create: { userId, step: SessionStep.IDLE, draft: {} } }); }
