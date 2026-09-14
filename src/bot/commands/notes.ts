import { Composer } from "grammy";
import { SessionStep } from "@prisma/client";
import { getOrCreateUser, setSessionStep, clearSession, getSession } from "@/bot/session";
import {
  createNote,
  createVoiceNote,
  listNotes,
  getOwnedNote,
  updateNote,
  deleteNote,
  ValidationError,
} from "@/services/notesService";
import {
  notesMenuKeyboard,
  noteItemKeyboard,
  notePaginationKeyboard,
  notesListKeyboard,
  notesPaginationKeyboard,
  notesDeleteSelectionKeyboard,
  cancelKeyboard,
  confirmDeleteKeyboard,
} from "@/bot/keyboards";
import { paginateNoteText } from "@/lib/notePagination";

export const notesComposer = new Composer();

const NOTES_LIST_PAGE_SIZE = 3500;
const BIG_NOTE_THRESHOLD = 300;

type NoteListItem = { id: number; text: string; voiceFileId: string | null };

function isBigNote(text: string): boolean {
  return text.length >= BIG_NOTE_THRESHOLD;
}

function getNoteNumber(notes: Array<{ id: number }>, noteId: number): number | null {
  const index = notes.findIndex((note) => note.id === noteId);
  return index === -1 ? null : index + 1;
}

function notePageText(noteNumber: number, page: string, pageNumber: number, totalPages: number): string {
  return totalPages === 1
    ? `📝 Заметка #${noteNumber}\n\n${page}`
    : `📝 Заметка #${noteNumber}\n\n${page}\n\n📄 Страница ${pageNumber} из ${totalPages}`;
}

function buildNotesListPages(notes: NoteListItem[]): string[] {
  if (notes.length === 0) return [];

  const pages: string[] = [];
  let currentNotes: string[] = [];
  let currentLength = "📋 Ваши заметки:\n\n".length;

  const pushCurrentPage = () => {
    if (currentNotes.length > 0) {
      pages.push(`📋 Ваши заметки:\n\n${currentNotes.join("\n\n")}`);
      currentNotes = [];
      currentLength = "📋 Ваши заметки:\n\n".length;
    }
  };

  for (const [index, note] of notes.entries()) {
    const big = !note.voiceFileId && isBigNote(note.text);
    const noteText = `#${index + 1} — ${note.voiceFileId ? "🎙️ Голосовое сообщение" : note.text}`;

    if (big) {
      pushCurrentPage();
      pages.push(`📋 Ваши заметки:\n\n${noteText}`);
      continue;
    }

    const separatorLength = currentNotes.length === 0 ? 0 : 2;
    const nextLength = currentLength + separatorLength + noteText.length;

    if (currentNotes.length > 0 && nextLength > NOTES_LIST_PAGE_SIZE) {
      pushCurrentPage();
    }

    currentNotes.push(noteText);
    currentLength += (currentNotes.length === 1 ? 0 : 2) + noteText.length;
  }

  pushCurrentPage();
  return pages;
}

function notesListPageKeyboard(page: number, totalPages: number) {
  return notesPaginationKeyboard(page, totalPages);
}

async function getNotesListPage(userId: number, page: number): Promise<{ text: string; page: number; totalPages: number }> {
  const notes = await listNotes(userId);

  if (notes.length === 0) {
    return { text: "📝 У вас пока нет заметок. Добавьте первую заметку:", page: 0, totalPages: 1 };
  }

  const pages = buildNotesListPages(notes);
  const safePage = Math.min(Math.max(page, 0), pages.length - 1);
  return { text: pages[safePage]!, page: safePage, totalPages: pages.length };
}

async function showNotesList(ctx: any, userId: number, page = 0) {
  const result = await getNotesListPage(userId, page);
  const replyMarkup = result.totalPages > 1
    ? notesListPageKeyboard(result.page, result.totalPages)
    : notesListKeyboard;
  await ctx.editMessageText(`${result.text}${result.totalPages > 1 ? `\n\n📄 Страница ${result.page + 1} из ${result.totalPages}` : ""}`, {
    reply_markup: replyMarkup,
  });
}

notesComposer.command("notes", async (ctx) => {
  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  const result = await getNotesListPage(user.id, 0);
  const replyMarkup = result.totalPages > 1
    ? notesListPageKeyboard(0, result.totalPages)
    : notesListKeyboard;
  await ctx.reply(`${result.text}${result.totalPages > 1 ? `\n\n📄 Страница 1 из ${result.totalPages}` : ""}`, {
    reply_markup: replyMarkup,
  });
});

notesComposer.callbackQuery("menu:notes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const result = await getNotesListPage(user.id, 0);
  const replyMarkup = result.totalPages > 1
    ? notesListPageKeyboard(0, result.totalPages)
    : notesListKeyboard;
  await ctx.editMessageText(`${result.text}${result.totalPages > 1 ? `\n\n📄 Страница 1 из ${result.totalPages}` : ""}`, {
    reply_markup: replyMarkup,
  });
});

notesComposer.callbackQuery(/^notes:list_page:(\d+)$/, async (ctx) => {
  const page = Number(ctx.match[1]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const result = await getNotesListPage(user.id, page);

  if (page !== result.page) {
    await ctx.answerCallbackQuery("Страница не найдена.");
    return;
  }

  await ctx.answerCallbackQuery();
  const replyMarkup = result.totalPages > 1
    ? notesListPageKeyboard(result.page, result.totalPages)
    : notesListKeyboard;
  await ctx.editMessageText(`${result.text}${result.totalPages > 1 ? `\n\n📄 Страница ${result.page + 1} из ${result.totalPages}` : ""}`, {
    reply_markup: replyMarkup,
  });
});

notesComposer.callbackQuery("notes:new", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await setSessionStep(user.id, SessionStep.NOTE_AWAITING_TEXT);
  await ctx.editMessageText("Введите текст новой заметки:", { reply_markup: cancelKeyboard });
});

notesComposer.callbackQuery("notes:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await showNotesList(ctx, user.id, 0);
});

notesComposer.callbackQuery("notes:delete_mode", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const notes = await listNotes(user.id);

  if (notes.length === 0) {
    await ctx.editMessageText("У вас пока нет заметок.", { reply_markup: notesListKeyboard });
    return;
  }

  const lines = notes
    .map((note, index) => `#${index + 1} — ${note.voiceFileId ? "🎙️ Голосовое сообщение" : note.text.length > 60 ? note.text.slice(0, 60) + "…" : note.text}`)
    .join("\n");

  await ctx.editMessageText(`🗑 Выберите номер заметки для удаления:\n\n${lines}`, {
    reply_markup: notesDeleteSelectionKeyboard(notes.map((note) => note.id)),
  });
});

notesComposer.callbackQuery(/^notes:delete_select:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = Number(ctx.match[1]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const note = await getOwnedNote(user.id, noteId);

  if (!note) {
    await ctx.editMessageText("Заметка не найдена или уже удалена.", { reply_markup: notesMenuKeyboard });
    return;
  }

  const notes = await listNotes(user.id);
  const noteNumber = getNoteNumber(notes, noteId);
  if (noteNumber === null) {
    await ctx.editMessageText("Заметка не найдена или уже удалена.", { reply_markup: notesMenuKeyboard });
    return;
  }

  await ctx.editMessageText(`Удалить заметку #${noteNumber}? Это необратимо.`, {
    reply_markup: confirmDeleteKeyboard("note", noteId),
  });
});

notesComposer.command("note", async (ctx) => {
  const arg = ctx.match?.toString().trim();
  const noteNumber = Number(arg);
  if (!arg || Number.isNaN(noteNumber) || !Number.isInteger(noteNumber) || noteNumber < 1) {
    await ctx.reply("Использование: /note <номер заметки>");
    return;
  }

  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  const notes = await listNotes(user.id);
  const note = notes[noteNumber - 1];
  if (!note) {
    await ctx.reply("Заметка не найдена.");
    return;
  }

  if (note.voiceFileId) {
    await ctx.reply(`📝 Заметка #${noteNumber}\n\n🎙️ Голосовое сообщение`, {
      reply_markup: noteItemKeyboard(note.id, true),
    });
    return;
  }

  const pages = paginateNoteText(note.text);
  await ctx.reply(notePageText(noteNumber, pages[0]!, 1, pages.length), {
    reply_markup: pages.length === 1 ? noteItemKeyboard(note.id) : notePaginationKeyboard(note.id, 0, pages.length),
  });
});

notesComposer.callbackQuery(/^notes:voice:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = Number(ctx.match[1]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const note = await getOwnedNote(user.id, noteId);
  if (!note?.voiceFileId) {
    await ctx.reply("Голосовое сообщение не найдено.");
    return;
  }
  await ctx.api.sendVoice(ctx.chat!.id, note.voiceFileId);
});

notesComposer.callbackQuery(/^notes:page:(\d+):(\d+)$/, async (ctx) => {
  const noteId = Number(ctx.match[1]);
  const pageNumber = Number(ctx.match[2]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const note = await getOwnedNote(user.id, noteId);

  if (!note) {
    await ctx.answerCallbackQuery("Заметка не найдена.");
    return;
  }

  if (note.voiceFileId) {
    await ctx.answerCallbackQuery("Голосовая заметка не имеет страниц.");
    return;
  }

  const pages = paginateNoteText(note.text);
  if (!Number.isInteger(pageNumber) || pageNumber < 0 || pageNumber >= pages.length) {
    await ctx.answerCallbackQuery("Страница не найдена.");
    return;
  }

  const notes = await listNotes(user.id);
  const noteNumber = getNoteNumber(notes, note.id);
  if (noteNumber === null) {
    await ctx.answerCallbackQuery("Заметка не найдена.");
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(notePageText(noteNumber, pages[pageNumber]!, pageNumber + 1, pages.length), {
    reply_markup: notePaginationKeyboard(note.id, pageNumber, pages.length),
  });
});

notesComposer.callbackQuery(/^notes:edit:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = Number(ctx.match[1]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const note = await getOwnedNote(user.id, noteId);
  if (!note) {
    await ctx.editMessageText("Заметка не найдена.");
    return;
  }

  const notes = await listNotes(user.id);
  const noteNumber = getNoteNumber(notes, noteId);
  if (noteNumber === null) {
    await ctx.editMessageText("Заметка не найдена.");
    return;
  }

  await setSessionStep(user.id, SessionStep.NOTE_EDIT_AWAITING_TEXT, { noteId });
  await ctx.editMessageText(`Введите новый текст для заметки #${noteNumber}:`, {
    reply_markup: cancelKeyboard,
  });
});

notesComposer.callbackQuery(/^notes:delete_confirm:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = Number(ctx.match[1]);
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const deleted = await deleteNote(user.id, noteId);
  if (!deleted) {
    await ctx.editMessageText("Заметка не найдена или уже удалена.");
    return;
  }
  await ctx.editMessageText("🗑 Заметка удалена.", { reply_markup: notesMenuKeyboard });
});

export async function handleNotesTextInput(ctx: any, userId: number): Promise<boolean> {
  const session = await getSession(userId);
  if (!session) return false;

  const text = ctx.message?.text as string | undefined;
  if (!text) return false;

  if (session.step === SessionStep.NOTE_AWAITING_TEXT) {
    try {
      const note = await createNote(userId, text);
      await clearSession(userId);
      const notes = await listNotes(userId);
      const noteNumber = getNoteNumber(notes, note.id) ?? 1;
      await ctx.reply(`✅ Заметка #${noteNumber} сохранена.`, { reply_markup: notesMenuKeyboard });
    } catch (err) {
      if (err instanceof ValidationError) await ctx.reply(`⚠️ ${err.message}\nПопробуйте ещё раз:`, { reply_markup: cancelKeyboard });
      else throw err;
    }
    return true;
  }

  if (session.step === SessionStep.NOTE_EDIT_AWAITING_TEXT) {
    const draft = (session.draft as { noteId?: number } | null) ?? {};
    const noteId = draft.noteId;
    if (!noteId) {
      await clearSession(userId);
      await ctx.reply("Что-то пошло не так, начните заново через /notes.");
      return true;
    }
    try {
      const updated = await updateNote(userId, noteId, text);
      await clearSession(userId);
      if (!updated) await ctx.reply("Заметка не найдена.");
      else {
        const notes = await listNotes(userId);
        const noteNumber = getNoteNumber(notes, updated.id) ?? 1;
        await ctx.reply(`✅ Заметка #${noteNumber} обновлена.`, { reply_markup: notesMenuKeyboard });
      }
    } catch (err) {
      if (err instanceof ValidationError) await ctx.reply(`⚠️ ${err.message}\nПопробуйте ещё раз:`, { reply_markup: cancelKeyboard });
      else throw err;
    }
    return true;
  }

  return false;
}

export async function handleNotesVoiceInput(ctx: any, userId: number): Promise<boolean> {
  const session = await getSession(userId);
  const voiceFileId = ctx.message?.voice?.file_id as string | undefined;
  if (!voiceFileId) return false;

  if (session?.step === SessionStep.NOTE_AWAITING_TEXT) {
    const note = await createVoiceNote(userId, voiceFileId);
    await clearSession(userId);
    const notes = await listNotes(userId);
    const noteNumber = getNoteNumber(notes, note.id) ?? 1;
    await ctx.reply(`📝 Заметка #${noteNumber}\n\n🎙️ Голосовое сообщение`, {
      reply_markup: noteItemKeyboard(note.id, true),
    });
    return true;
  }

  if (session?.step === SessionStep.NOTE_EDIT_AWAITING_TEXT) {
    await ctx.reply("Голосовое сообщение нельзя использовать для изменения заметки. Введите новый текст или отмените действие.", { reply_markup: cancelKeyboard });
    return true;
  }

  return false;
}
