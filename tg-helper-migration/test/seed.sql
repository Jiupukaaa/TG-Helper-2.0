-- Synthetic data for the local export/convert test.
-- Mirrors the real Prisma schema and includes quotes, newlines, unicode,
-- nullable columns, JSONB, all enum values used by the app, and FKs.

INSERT INTO users (id, "telegramId", timezone, "createdAt", "updatedAt") VALUES
  (1, 1001, 'Europe/Amsterdam', '2026-09-01 10:00:00.123', '2026-09-02 11:00:00.456'),
  (2, 1002, 'UTC', '2026-09-01 10:05:00', '2026-09-01 10:05:00');

INSERT INTO shifts (id, name, "startAt", "ownerId", "cycleGroupId", "createdAt", "updatedAt") VALUES
  (1, 'Day shift', '2026-09-03 08:00:00', 1, 'cycle-1', '2026-09-01 12:00:00', '2026-09-01 12:00:00'),
  (2, NULL, '2026-09-04 08:00:00', 1, NULL, '2026-09-01 12:01:00', '2026-09-01 12:01:00'),
  (3, 'Night', '2026-09-05 20:00:00', 2, NULL, '2026-09-01 12:02:00', '2026-09-01 12:02:00');

INSERT INTO notes (id, text, "voiceFileId", "ownerId", "createdAt", "updatedAt") VALUES
  (1, 'O''Brien said "hi"', NULL, 1, '2026-09-02 09:00:00', '2026-09-02 09:00:00'),
  (2, E'Line 1\nLine 2 — юникод', 'voice-file-id', 1, '2026-09-02 09:01:00', '2026-09-02 09:01:00'),
  (3, 'Заметка', NULL, 2, '2026-09-02 09:02:00', '2026-09-02 09:02:00');

INSERT INTO saved_items (id, type, url, "fileId", "ownerId", "createdAt", "updatedAt") VALUES
  (1, 'LINK', 'https://example.com/?a=1&b=2', NULL, 1, '2026-09-02 10:00:00', '2026-09-02 10:00:00'),
  (2, 'PHOTO', NULL, 'file-id', 1, '2026-09-02 10:01:00', '2026-09-02 10:01:00'),
  (3, 'GIF', NULL, 'gif-id', 2, '2026-09-02 10:02:00', '2026-09-02 10:02:00');

INSERT INTO reminders (
  id, text, "voiceFileId", "dueAt", status, "processingStartedAt", "sentAt",
  "retryCount", "lastError", "ownerId", "shiftId", "offsetMinutes",
  "repeatGroupId", "repeatRule", "createdAt", "updatedAt"
) VALUES
  (1, 'PENDING reminder', NULL, '2026-09-10 09:00:00', 'PENDING', NULL, NULL,
   0, NULL, 1, 1, 0, NULL, NULL, '2026-09-02 11:00:00', '2026-09-02 11:00:00'),
  (2, 'SENT reminder', 'voice', '2026-09-10 10:00:00', 'SENT', '2026-09-10 09:55:00', '2026-09-10 10:00:01',
   0, NULL, 1, NULL, NULL, 'group-1', 'daily', '2026-09-02 11:01:00', '2026-09-10 10:00:01'),
  (3, 'FAILED reminder', NULL, '2026-09-10 11:00:00', 'FAILED', '2026-09-10 10:59:00', NULL,
   3, 'telegram error', 2, NULL, NULL, NULL, NULL, '2026-09-02 11:02:00', '2026-09-10 11:01:00'),
  (4, 'PROCESSING reminder', NULL, '2026-09-10 12:00:00', 'PROCESSING', '2026-09-10 11:59:00', NULL,
   1, NULL, 2, 3, 15, NULL, NULL, '2026-09-02 11:03:00', '2026-09-10 11:59:00');

INSERT INTO sessions (id, "userId", step, draft, "updatedAt") VALUES
  (1, 1, 'NOTE_AWAITING_TEXT', '{"noteId":1,"text":"O''Brien","nested":{"x":2}}'::jsonb, '2026-09-02 12:00:00'),
  (2, 2, 'IDLE', NULL, '2026-09-02 12:01:00');
