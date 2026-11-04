import { all, first, run } from "@/db/client";
import { SessionStep, type Session, type User } from "@/db/types";

export type ReminderDraft = {
  text?: string;
  voiceFileId?: string;
  dueAt?: string;
  awaitingRepeatCount?: boolean;
  repeatRule?: "daily" | "weekly" | "monthly";
  editMode?: "date" | "time" | "text";
  editReminderId?: number;
};
export type NoteEditDraft = { noteId?: number };
export type ShiftDraft = { dates?: string[]; calendarMonth?: string; time?: string; endTime?: string; workDays?: number; offDays?: number; firstDate?: string; editShiftId?: number; pendingStarts?: string[]; pendingEnds?: string[]; freeTime?: boolean; freeMode?: "single" | "range"; freeStartDate?: string; freeEndDate?: string };
export type SessionDraft = ReminderDraft & NoteEditDraft & ShiftDraft & { ids?: number[] };

type UserRow = Omit<User, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
type SessionRow = Omit<Session, "updatedAt" | "draft"> & { updatedAt: string; draft: string | null };

function mapUser(row: UserRow): User {
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

export async function getOrCreateUser(telegramId: bigint): Promise<User> {
  const numericId = Number(telegramId);
  if (!Number.isSafeInteger(numericId)) throw new Error("Telegram ID is outside the safe integer range.");
  const now = new Date().toISOString();
  const rows = await all<UserRow>(
    `INSERT INTO users (telegramId, timezone, createdAt, updatedAt)
     VALUES (?, 'UTC', ?, ?)
     ON CONFLICT(telegramId) DO UPDATE SET telegramId = excluded.telegramId
     RETURNING id, telegramId, timezone, createdAt, updatedAt`,
    numericId, now, now,
  );
  if (!rows[0]) throw new Error("Could not create or load user.");
  return mapUser(rows[0]);
}

export async function updateUserTimezone(userId: number, timezone: string): Promise<void> {
  await run("UPDATE users SET timezone = ?, updatedAt = ? WHERE id = ?", timezone, new Date().toISOString(), userId);
}

export async function setSessionStep(userId: number, step: SessionStep, draft: SessionDraft = {}): Promise<void> {
  const now = new Date().toISOString();
  await run(
    `INSERT INTO sessions (userId, step, draft, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET step = excluded.step, draft = excluded.draft, updatedAt = excluded.updatedAt`,
    userId, step, JSON.stringify(draft), now,
  );
}

export async function getSession(userId: number): Promise<Session | null> {
  const row = await first<SessionRow>("SELECT id, userId, step, draft, updatedAt FROM sessions WHERE userId = ?", userId);
  if (!row) return null;
  let draft: Record<string, unknown> | null = null;
  if (row.draft !== null) {
    try { draft = JSON.parse(row.draft) as Record<string, unknown>; }
    catch { draft = null; }
  }
  return { id: row.id, userId: row.userId, step: row.step, draft, updatedAt: new Date(row.updatedAt) };
}

export async function clearSession(userId: number): Promise<void> {
  await setSessionStep(userId, SessionStep.IDLE, {});
}
