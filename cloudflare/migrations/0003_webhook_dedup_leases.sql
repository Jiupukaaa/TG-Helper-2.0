-- Add processing lease fields to webhook deduplication.
-- The status column already exists in the remote database and is managed
-- by an earlier schema change, so this migration adds only missing fields.

ALTER TABLE webhook_dedup ADD COLUMN lockedUntil TEXT;
ALTER TABLE webhook_dedup ADD COLUMN lockToken TEXT;
ALTER TABLE webhook_dedup ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
