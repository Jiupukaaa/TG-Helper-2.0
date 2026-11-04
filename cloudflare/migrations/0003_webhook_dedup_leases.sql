-- Extend webhook deduplication with processing leases.
-- Existing rows were written by the previous implementation and represent
-- already-processed Telegram updates, so preserve them as PROCESSED.

ALTER TABLE webhook_dedup ADD COLUMN status TEXT NOT NULL DEFAULT 'PROCESSED';
ALTER TABLE webhook_dedup ADD COLUMN lockedUntil TEXT;
ALTER TABLE webhook_dedup ADD COLUMN lockToken TEXT;
ALTER TABLE webhook_dedup ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
