ALTER TABLE webhook_dedup ADD COLUMN status TEXT NOT NULL DEFAULT 'PROCESSED'
  CHECK (status IN ('PROCESSING', 'PROCESSED'));
ALTER TABLE webhook_dedup ADD COLUMN lockedUntil TEXT;
ALTER TABLE webhook_dedup ADD COLUMN lockToken TEXT;
ALTER TABLE webhook_dedup ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
CREATE INDEX webhook_dedup_status_lockedUntil_idx ON webhook_dedup(status, lockedUntil);

-- Store the originating Telegram update on records created from incoming messages.
-- Nullable values preserve existing rows and non-webhook service callers.
ALTER TABLE notes ADD COLUMN sourceUpdateId INTEGER;
CREATE UNIQUE INDEX notes_sourceUpdateId_idx ON notes(sourceUpdateId);

ALTER TABLE saved_items ADD COLUMN sourceUpdateId INTEGER;
CREATE UNIQUE INDEX saved_items_sourceUpdateId_idx ON saved_items(sourceUpdateId);

ALTER TABLE reminders ADD COLUMN sourceUpdateId INTEGER;
ALTER TABLE reminders ADD COLUMN sourceIndex INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX reminders_sourceUpdateId_sourceIndex_idx ON reminders(sourceUpdateId, sourceIndex);
