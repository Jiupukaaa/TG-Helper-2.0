export const SessionStep = {
  IDLE: "IDLE",
  NOTE_AWAITING_TEXT: "NOTE_AWAITING_TEXT",
  NOTE_EDIT_AWAITING_TEXT: "NOTE_EDIT_AWAITING_TEXT",
  NOTE_VOICE_REPLACE_AWAITING: "NOTE_VOICE_REPLACE_AWAITING",
  REMINDER_AWAITING_TEXT: "REMINDER_AWAITING_TEXT",
  REMINDER_AWAITING_DATETIME: "REMINDER_AWAITING_DATETIME",
  SHIFT_MANUAL_AWAITING_TIME: "SHIFT_MANUAL_AWAITING_TIME",
  SHIFT_MANUAL_AWAITING_NAME: "SHIFT_MANUAL_AWAITING_NAME",
  SHIFT_CYCLE_AWAITING_WORK_DAYS: "SHIFT_CYCLE_AWAITING_WORK_DAYS",
  SHIFT_CYCLE_AWAITING_OFF_DAYS: "SHIFT_CYCLE_AWAITING_OFF_DAYS",
  SHIFT_CYCLE_AWAITING_START_DATE: "SHIFT_CYCLE_AWAITING_START_DATE",
  SHIFT_CYCLE_AWAITING_TIME: "SHIFT_CYCLE_AWAITING_TIME",
  SHIFT_CYCLE_AWAITING_END_DATE: "SHIFT_CYCLE_AWAITING_END_DATE",
  SHIFT_CYCLE_AWAITING_NAME: "SHIFT_CYCLE_AWAITING_NAME",
  SHIFT_EDIT_AWAITING_NAME: "SHIFT_EDIT_AWAITING_NAME",
} as const;
export type SessionStep = (typeof SessionStep)[keyof typeof SessionStep];
export const ReminderStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SENT: "SENT",
  FAILED: "FAILED",
} as const;
export type ReminderStatus = (typeof ReminderStatus)[keyof typeof ReminderStatus];
export type User = { id: number; telegramId: number; timezone: string; createdAt: Date; updatedAt: Date };
export type Note = { id: number; text: string; voiceFileId: string | null; ownerId: number; createdAt: Date; updatedAt: Date };
export type SavedItem = { id: number; type: "LINK" | "PHOTO" | "GIF"; url: string | null; fileId: string | null; ownerId: number; createdAt: Date; updatedAt: Date };
export type Shift = { id: number; name: string | null; startAt: Date; ownerId: number; cycleGroupId: string | null; createdAt: Date; updatedAt: Date };
export type Reminder = { id: number; text: string; voiceFileId: string | null; dueAt: Date; status: ReminderStatus; processingStartedAt: Date | null; sentAt: Date | null; retryCount: number; lastError: string | null; ownerId: number; shiftId: number | null; offsetMinutes: number | null; repeatGroupId: string | null; repeatRule: string | null; createdAt: Date; updatedAt: Date };
export type Session = { id: number; userId: number; step: SessionStep; draft: Record<string, unknown> | null; updatedAt: Date };
