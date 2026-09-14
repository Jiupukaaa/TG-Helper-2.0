import { Composer } from "grammy";
import { getOrCreateUser } from "@/services/users";
import {
  createNote,
  deleteNote,
  getOwnedNote,
  listNotes,
  updateNote,
} from "@/services/notesService";
import { SessionStep } from "@/bot/session";
import {
  cancelKeyboard,
  noteItemKeyboard,
  notePaginationKeyboard,
  notesDeleteSelectionKeyboard,
  notesListKeyboard,
  notesMenuKeyboard,
} from "@/bot/keyboards";
import { getNoteNumber, getNotesListText } from "@/bot/notes";
import { paginateNoteText } from "@/lib/notePagination";
import { setSessionStep } from "@/services/sessionService";

export const notesComposer = new Composer<any>();

function notePageText(noteNumber: number, page: string, pageNumber: number, totalPages: number): string {
  return totalPages === 1
    ? `📝 Заметка #${noteNumber}\n\n${page}`
    : `📝 Заметка #${noteNumber}\n\n${page}\n\n📄 Страница ${pageNumber} из ${totalPages}`;
}

notesComposer.command("notes", async (ctx) => {
  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  const notes = await listNotes(user.id);
  await ctx.reply(getNotesListText(notes), {
    reply_markup: notesListKeyboard(notes),
  });
});

notesComposer.callbackQuery("notes:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const notes = await listNotes(user.id);
  await ctx.editMessageText(getNotesListText(notes), {
    reply_markup: notesListKeyboard(notes),
  });
});

notesComposer.callbackQuery("notes:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("📝 Заметки", {
    reply_markup: notesMenuKeyboard,
  });
});

notesComposer.callbackQuery("notes:create", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await setSessionStep(user.id, SessionStep.NOTE_CREATE_AWAITING_TEXT);
  await ctx.editMessageText("Введите текст новой заметки:", {
    reply_markup: cancelKeyboard,
  });
});

notesComposer.command("note", async (ctx) => {
  const arg = ctx.match?.trim();
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

  const pages = paginateNoteText(note.text);
  await ctx.reply(notePageText(noteNumber, pages[0]!, 1, pages.length), {
    reply_markup: pages.length === 1 ? noteItemKeyboard(note.id) : notePaginationKeyboard(note.id, 0, pages.length),
  });
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

  const notes = await listNotes(user.id);
  await ctx.editMessageText(getNotesListText(notes), {
    reply_markup: notesListKeyboard(notes),
  });
});

notesComposer.callbackQuery(/^notes:delete_select:(\d+)$/, async (ctx) => {
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

  await ctx.editMessageText(`Удалить заметку #${noteNumber}?`, {
    reply_markup: notesDeleteSelectionKeyboard(note.id),
  });
});

notesComposer.callbackQuery("notes:delete", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const notes = await listNotes(user.id);
  if (notes.length === 0) {
    await ctx.editMessageText("Заметок пока нет.", {
      reply_markup: notesMenuKeyboard,
    });
    return;
  }

  await ctx.editMessageText("Выберите заметку для удаления:", {
    reply_markup: notesDeleteSelectionKeyboard(notes),
  });
});

notesComposer.callbackQuery(/^notes:delete_cancel:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const notes = await listNotes(user.id);
  await ctx.editMessageText(getNotesListText(notes), {
    reply_markup: notesListKeyboard(notes),
  });
});

export async function handleNoteText(userId: bigint, text: string) {
  return createNote(userId, text);
}

export async function handleNoteEdit(userId: bigint, noteId: number, text: string) {
  return updateNote(userId, noteId, text);
}
