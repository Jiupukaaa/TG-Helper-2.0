import { prisma } from "@/lib/prisma";

const MAX_NOTE_LENGTH = 4000; // Telegram message limit is 4096; leave headroom for formatting.
export const VOICE_NOTE_TEXT = "🎙️ Голосовое сообщение";

export class ValidationError extends Error {}

export function validateNoteText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Текст заметки не может быть пустым.");
  }
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(
      `Слишком длинный текст (максимум ${MAX_NOTE_LENGTH} символов).`
    );
  }
  return trimmed;
}

export async function createNote(ownerId: number, text: string) {
  const validated = validateNoteText(text);
  return prisma.note.create({ data: { ownerId, text: validated } });
}

export async function createVoiceNote(ownerId: number, voiceFileId: string) {
  return prisma.note.create({
    data: { ownerId, text: VOICE_NOTE_TEXT, voiceFileId },
  });
}

export async function replaceVoiceNote(ownerId: number, noteId: number, voiceFileId: string) {
  const existing = await getOwnedNote(ownerId, noteId);
  if (!existing?.voiceFileId) return null;
  return prisma.note.update({
    where: { id: noteId },
    data: { text: VOICE_NOTE_TEXT, voiceFileId },
  });
}

export async function listNotes(ownerId: number) {
  return prisma.note.findMany({
    where: { ownerId },
    orderBy: { id: "asc" },
  });
}

/** Returns the note only if it belongs to ownerId — never leaks other users' notes. */
export async function getOwnedNote(ownerId: number, noteId: number) {
  return prisma.note.findFirst({ where: { id: noteId, ownerId } });
}

export async function updateNote(ownerId: number, noteId: number, text: string) {
  const validated = validateNoteText(text);
  const existing = await getOwnedNote(ownerId, noteId);
  if (!existing) return null;
  return prisma.note.update({
    where: { id: noteId },
    data: { text: validated, voiceFileId: null },
  });
}

export async function deleteNote(ownerId: number, noteId: number) {
  const existing = await getOwnedNote(ownerId, noteId);
  if (!existing) return null;
  return prisma.note.delete({ where: { id: noteId } });
}
