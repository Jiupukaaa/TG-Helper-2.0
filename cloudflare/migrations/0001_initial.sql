-- TG Helper 2.0 D1 schema, migration 0001.
-- SQLite/D1 equivalent of the current Prisma models on main.
-- This creates an empty schema only; it does not import or alter Neon data.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegramId INTEGER NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  voiceFileId TEXT,
  ownerId INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS notes_ownerId_idx ON notes(ownerId);

CREATE TABLE IF NOT EXISTS saved_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('LINK', 'PHOTO', 'GIF')),
  url TEXT,
  fileId TEXT,
  ownerId INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS saved_items_ownerId_idx ON saved_items(ownerId);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  startAt TEXT NOT NULL,
  ownerId INTEGER NOT NULL,
  cycleGroupId TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE (ownerId, startAt)
);
CREATE INDEX IF NOT EXISTS shifts_ownerId_startAt_idx ON shifts(ownerId, startAt);
CREATE INDEX IF NOT EXISTS shifts_ownerId_cycleGroupId_idx ON shifts(ownerId, cycleGroupId);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  voiceFileId TEXT,
  dueAt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
  processingStartedAt TEXT,
  sentAt TEXT,
  retryCount INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  ownerId INTEGER NOT NULL,
  shiftId INTEGER,
  offsetMinutes INTEGER,
  repeatGroupId TEXT,
  repeatRule TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (shiftId) REFERENCES shifts(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE (shiftId, offsetMinutes)
);
CREATE INDEX IF NOT EXISTS reminders_status_dueAt_idx ON reminders(status, dueAt);
CREATE INDEX IF NOT EXISTS reminders_ownerId_idx ON reminders(ownerId);
CREATE INDEX IF NOT EXISTS reminders_shiftId_idx ON reminders(shiftId);
CREATE INDEX IF NOT EXISTS reminders_ownerId_repeatGroupId_idx ON reminders(ownerId, repeatGroupId);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  step TEXT NOT NULL DEFAULT 'IDLE' CHECK (step IN (
    'IDLE',
    'NOTE_AWAITING_TEXT',
    'NOTE_EDIT_AWAITING_TEXT',
    'NOTE_VOICE_REPLACE_AWAITING',
    'REMINDER_AWAITING_TEXT',
    'REMINDER_AWAITING_DATETIME',
    'SHIFT_MANUAL_AWAITING_TIME',
    'SHIFT_MANUAL_AWAITING_NAME',
    'SHIFT_CYCLE_AWAITING_WORK_DAYS',
    'SHIFT_CYCLE_AWAITING_OFF_DAYS',
    'SHIFT_CYCLE_AWAITING_START_DATE',
    'SHIFT_CYCLE_AWAITING_TIME',
    'SHIFT_CYCLE_AWAITING_END_DATE',
    'SHIFT_CYCLE_AWAITING_NAME',
    'SHIFT_EDIT_AWAITING_NAME'
  )),
  draft TEXT,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS reminders_ownerId_repeatGroupId_idx ON reminders(ownerId, repeatGroupId);
