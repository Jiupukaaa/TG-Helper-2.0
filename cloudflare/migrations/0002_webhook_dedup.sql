CREATE TABLE IF NOT EXISTS webhook_dedup (
  updateId INTEGER PRIMARY KEY,
  processedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_dedup_processedAt_idx ON webhook_dedup(processedAt);
