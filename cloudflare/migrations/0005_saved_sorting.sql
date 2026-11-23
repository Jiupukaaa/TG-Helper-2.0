-- Saved-items comments and sorting progress.
-- Existing saved_items rows remain intact and enter the initial sorting queue.

ALTER TABLE saved_items ADD COLUMN comment TEXT;
ALTER TABLE saved_items ADD COLUMN sortedAt TEXT;

CREATE TABLE IF NOT EXISTS saved_item_comment_sessions (
  userId INTEGER PRIMARY KEY,
  savedItemId INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('ADD', 'SORT')),
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (savedItemId) REFERENCES saved_items(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS saved_item_comment_sessions_savedItemId_idx
  ON saved_item_comment_sessions(savedItemId);
