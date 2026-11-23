import { all, first, run } from "@/db/client";
import type { SavedItem } from "@/db/types";

export type SavedItemType = "LINK" | "PHOTO" | "GIF";
export type SavedCommentMode = "ADD" | "SORT";
export type SavedCommentSession = { userId: number; savedItemId: number; mode: SavedCommentMode; createdAt: Date };
type SavedItemRow = Omit<SavedItem, "createdAt" | "updatedAt" | "sortedAt"> & {
  createdAt: string;
  updatedAt: string;
  sortedAt: string | null;
};
type SavedCommentSessionRow = { userId: number; savedItemId: number; mode: SavedCommentMode; createdAt: string };

function mapSavedItem(row: SavedItemRow): SavedItem {
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), sortedAt: row.sortedAt ? new Date(row.sortedAt) : null };
}

export function detectSavedLink(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" ||
        host === "tiktok.com" || host.endsWith(".tiktok.com") ||
        host === "twitch.tv" || host.endsWith(".twitch.tv")) return url.toString();
  } catch {
    return null;
  }
  return null;
}

async function createSavedItem(ownerId: number, type: SavedItemType, url: string | null, fileId: string | null): Promise<SavedItem> {
  const now = new Date().toISOString();
  const rows = await all<SavedItemRow>(
    "INSERT INTO saved_items (type, url, fileId, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
    type, url, fileId, ownerId, now, now,
  );
  if (!rows[0]) throw new Error("Не удалось сохранить элемент.");
  return mapSavedItem(rows[0]);
}

export async function createSavedLink(ownerId: number, url: string): Promise<SavedItem> {
  return createSavedItem(ownerId, "LINK", url, null);
}
export async function createSavedPhoto(ownerId: number, fileId: string): Promise<SavedItem> {
  return createSavedItem(ownerId, "PHOTO", null, fileId);
}
export async function createSavedGif(ownerId: number, fileId: string): Promise<SavedItem> {
  return createSavedItem(ownerId, "GIF", null, fileId);
}
export async function listSavedItems(ownerId: number): Promise<SavedItem[]> {
  const rows = await all<SavedItemRow>("SELECT * FROM saved_items WHERE ownerId = ? ORDER BY id ASC", ownerId);
  return rows.map(mapSavedItem);
}
export async function getOwnedSavedItem(ownerId: number, id: number): Promise<SavedItem | null> {
  const row = await first<SavedItemRow>("SELECT * FROM saved_items WHERE id = ? AND ownerId = ?", id, ownerId);
  return row ? mapSavedItem(row) : null;
}
export async function getNextUnsortedSavedItem(ownerId: number): Promise<SavedItem | null> {
  const row = await first<SavedItemRow>(
    "SELECT * FROM saved_items WHERE ownerId = ? AND sortedAt IS NULL ORDER BY id ASC LIMIT 1",
    ownerId,
  );
  return row ? mapSavedItem(row) : null;
}
export async function countUnsortedSavedItems(ownerId: number): Promise<number> {
  const row = await first<{ count: number }>("SELECT COUNT(*) AS count FROM saved_items WHERE ownerId = ? AND sortedAt IS NULL", ownerId);
  return row?.count ?? 0;
}
export async function deleteSavedItem(ownerId: number, id: number): Promise<SavedItem | null> {
  const rows = await all<SavedItemRow>("DELETE FROM saved_items WHERE id = ? AND ownerId = ? RETURNING *", id, ownerId);
  return rows[0] ? mapSavedItem(rows[0]) : null;
}
export async function beginSavedComment(ownerId: number, itemId: number, mode: SavedCommentMode): Promise<boolean> {
  const item = await getOwnedSavedItem(ownerId, itemId);
  if (!item || (mode === "SORT" && item.sortedAt)) return false;
  await run(
    "INSERT INTO saved_item_comment_sessions (userId, savedItemId, mode, createdAt) VALUES (?, ?, ?, ?) ON CONFLICT(userId) DO UPDATE SET savedItemId = excluded.savedItemId, mode = excluded.mode, createdAt = excluded.createdAt",
    ownerId, itemId, mode, new Date().toISOString(),
  );
  return true;
}
export async function getSavedCommentSession(ownerId: number): Promise<SavedCommentSession | null> {
  const row = await first<SavedCommentSessionRow>(
    "SELECT userId, savedItemId, mode, createdAt FROM saved_item_comment_sessions WHERE userId = ?",
    ownerId,
  );
  return row ? { ...row, createdAt: new Date(row.createdAt) } : null;
}
export async function cancelSavedComment(ownerId: number): Promise<void> {
  await run("DELETE FROM saved_item_comment_sessions WHERE userId = ?", ownerId);
}
export async function savePendingSavedComment(ownerId: number, comment: string): Promise<{ mode: SavedCommentMode; saved: boolean } | null> {
  const session = await getSavedCommentSession(ownerId);
  if (!session) return null;
  const now = new Date().toISOString();
  const rows = session.mode === "SORT"
    ? await all<{ id: number }>(
        "UPDATE saved_items SET comment = ?, sortedAt = ?, updatedAt = ? WHERE id = ? AND ownerId = ? AND sortedAt IS NULL RETURNING id",
        comment, now, now, session.savedItemId, ownerId,
      )
    : await all<{ id: number }>(
        "UPDATE saved_items SET comment = ?, updatedAt = ? WHERE id = ? AND ownerId = ? RETURNING id",
        comment, now, session.savedItemId, ownerId,
      );
  await cancelSavedComment(ownerId);
  return { mode: session.mode, saved: rows.length > 0 };
}
