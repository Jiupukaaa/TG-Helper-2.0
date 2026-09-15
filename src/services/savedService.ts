import { prisma } from "@/lib/prisma";

export type SavedItemType = "LINK" | "PHOTO" | "GIF";

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

export async function createSavedLink(ownerId: number, url: string) {
  return prisma.savedItem.create({
    data: { ownerId, type: "LINK", url },
  });
}

export async function createSavedPhoto(ownerId: number, fileId: string) {
  return prisma.savedItem.create({
    data: { ownerId, type: "PHOTO", fileId },
  });
}

export async function createSavedGif(ownerId: number, fileId: string) {
  return prisma.savedItem.create({
    data: { ownerId, type: "GIF", fileId },
  });
}

export async function listSavedItems(ownerId: number) {
  return prisma.savedItem.findMany({
    where: { ownerId },
    orderBy: { id: "asc" },
  });
}

export async function getOwnedSavedItem(ownerId: number, id: number) {
  return prisma.savedItem.findFirst({ where: { id, ownerId } });
}

export async function deleteSavedItem(ownerId: number, id: number) {
  const item = await getOwnedSavedItem(ownerId, id);
  if (!item) return null;
  return prisma.savedItem.delete({ where: { id } });
}
