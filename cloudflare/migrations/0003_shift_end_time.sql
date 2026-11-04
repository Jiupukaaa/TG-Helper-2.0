-- Store the end time for each shift. Existing shifts remain NULL until edited.
ALTER TABLE shifts ADD COLUMN endAt TEXT;
