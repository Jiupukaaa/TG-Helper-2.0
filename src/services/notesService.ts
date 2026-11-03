import { all, first, run } from "@/db/client";
import type { Note } from "@/db/types";

const MAX_NOTE_LENGTH = 4000; // Telegram message limit is 4096; leave headroom for formatting.
export const VOICE_NOTE_TEXT = "🎙️ Голосовое сообщение";

export class ValidationError extends Error {}

type NoteRow = Omit<Note, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

function mapNote(row: NoteRow): Note {
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

export function validateNoteText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new ValidationError("Текст заметки не может быть пустым.");
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(`Слишком длинный текст (максимум ${MAX_NOTE_LENGTH} символов).`);
  }
  return trimmed;
}

export async function createNote(ownerId: number, text: string): Promise<Note> {
  const validated = validateNoteText(text);
  const now = new Date().toISOString();
  const rows = await all<NoteRow>(
    "INSERT INTO notes (text, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?) RETURNING *",
    validated, ownerId, now, now,
  );
  if (!rows[0]) throw new Error("Не удалось создать заметку.");
  return mapNote(rows[0]);
}

export async function createVoiceNote(ownerId: number, voiceFileId: string): Promise<Note> {
  const now = new Date().toISOString();
  const rows = await all<NoteRow>(
    "INSERT INTO notes (text, voiceFileId, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?) RETURNING *",
    VOICE_NOTE_TEXT, voiceFileId, ownerId, now, now,
  );
  if (!rows[0]) throw new Error("Не удалось создать голосовую заметку.");
  return mapNote(rows[0]);
}

export async function replaceVoiceNote(ownerId: number, noteId: number, voiceFileId: string): Promise<Note | null> {
  const existing = await getOwnedNote(ownerId, noteId);
  if (!existing?.voiceFileId) return null;
  const rows = await all<NoteRow>(
    "UPDATE notes SET text = ?, voiceFileId = ?, updatedAt = ? WHERE id = ? AND ownerId = ? AND voiceFileId IS NOT NULL RETURNING *",
    VOICE_NOTE_TEXT, voiceFileId, new Date().toISOString(), noteId, ownerId,
  );
  return rows[0] ? mapNote(rows[0]) : null;
}

export async function listNotes(ownerId: number): Promise<Note[]> {
  const rows = await all<NoteRow>("SELECT * FROM notes WHERE ownerId = ? ORDER BY id ASC", ownerId);
  return rows.map(mapNote);
}

/** Returns the note only if it belongs to ownerId — never leaks other users' notes. */
export async function getOwnedNote(ownerId: number, noteId: number): Promise<Note | null> {
  const row = await first<NoteRow>("SELECT * FROM notes WHERE id = ? AND ownerId = ?", noteId, ownerId);
  return row ? mapNote(row) : null;
}

export async function updateNote(ownerId: number, noteId: number, text: string): Promise<Note | null> {
  const validated = validateNoteText(text);
  const rows = await all<NoteRow>(
    "UPDATE notes SET text = ?, voiceFileId = NULL, updatedAt = ? WHERE id = ? AND ownerId = ? RETURNING *",
    validated, new Date().toISOString(), noteId, ownerId,
  );
  return rows[0] ? mapNote(rows[0]) : null;
}

export async function deleteNote(ownerId: number, noteId: number): Promise<Note | null> {
  const rows = await all<NoteRow>("DELETE FROM notes WHERE id = ? AND ownerId = ? RETURNING *", noteId, ownerId);
  return rows[0] ? mapNote(rows[0]) : null;
}
