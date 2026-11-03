import { all, first } from "@/db/client";
import type { SavedItem } from "@/db/types";

export type SavedItemType = "LINK" | "PHOTO" | "GIF";
type SavedItemRow = Omit<SavedItem, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

function mapSavedItem(row: SavedItemRow): SavedItem {
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

export function detectSavedLink(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" ||
        host === "tiktok.com" || host.endsWith(".tiktok.com") ||
        host === "twitch.tv" || host.endsWith(".twitch.tv")) {
      return url.toString();
    }
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

export async function deleteSavedItem(ownerId: number, id: number): Promise<SavedItem | null> {
  const rows = await all<SavedItemRow>("DELETE FROM saved_items WHERE id = ? AND ownerId = ? RETURNING *", id, ownerId);
  return rows[0] ? mapSavedItem(rows[0]) : null;
}
