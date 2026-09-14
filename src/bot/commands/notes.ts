import { Composer } from "grammy";
import { SessionStep } from "@prisma/client";
import { getOrCreateUser, setSessionStep, clearSession, getSession } from "@/bot/session";
import {
  createNote,
  listNotes,
  getOwnedNote,
  updateNote,
  deleteNote,
  ValidationError,
} from "@/services/notesService";
import {
  notesMenuKeyboard,
  noteItemKeyboard,
  notesListKeyboard,
  notesDeleteSelectionKeyboard,
  cancelKeyboard,
  confirmDeleteKeyboard,
} from "@/bot/keyboards";

export const notesComposer = new Composer();

function getNoteNumber(notes: Array<{ id: number }>, noteId: number): number | null {
  const index = notes.findIndex((note) => note.id === noteId);
  return index === -1 ? null : index + 1;
}

async function getNotesListText(userId: number): Promise<string> {
  const notes = await listNotes(userId);

  if (notes.length === 0) {
    return "📝 У вас пока нет заметок. Добавьте первую заметку:";
  }

  const lines = notes
    .map((n, index) => `#${index + 1} — ${n.text.length > 60 ? n.text.slice(0, 60) + "…" : n.text}`)
    .join("\n");

  return `📋 Ваши заметки:\n\n${lines}\n\nВыберите действие:`;
}

notesComposer.command("notes", async (ctx) => {
  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  const text = await getNotesListText(user.id);
  await ctx.reply(text, { reply_markup: notesListKeyboard });
});

notesComposer.callbackQuery("menu:notes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const text = await getNotesListText(user.id);
  await ctx.editMessageText(text, { reply_markup: notesListKeyboard });
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
  const text = await getNotesListText(user.id);
  await ctx.editMessageText(text, { reply_markup: notesListKeyboard });
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
    .map((note, index) => `#${index + 1} — ${note.text.length > 60 ? note.text.slice(0, 60) + "…" : note.text}`)
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
    await ctx.editMessageText("Заметка не найдена или уже удалена.", {
      reply_markup: notesMenuKeyboard,
    });
    return;
  }

  const notes = await listNotes(user.id);
  const noteNumber = getNoteNumber(notes, noteId);
  if (noteNumber === null) {
    await ctx.editMessageText("Заметка не найдена или уже удалена.", {
      reply_markup: notesMenuKeyboard,
    });
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

  await ctx.reply(`📝 Заметка #${noteNumber}\n\n${note.text}`, {
    reply_markup: noteItemKeyboard(note.id),
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
      if (err instanceof ValidationError) {
        await ctx.reply(`⚠️ ${err.message}\nПопробуйте ещё раз:`, { reply_markup: cancelKeyboard });
      } else {
        throw err;
      }
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
      if (!updated) {
        await ctx.reply("Заметка не найдена.");
      } else {
        const notes = await listNotes(userId);
        const noteNumber = getNoteNumber(notes, updated.id) ?? 1;
        await ctx.reply(`✅ Заметка #${noteNumber} обновлена.`, { reply_markup: notesMenuKeyboard });
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        await ctx.reply(`⚠️ ${err.message}\nПопробуйте ещё раз:`, { reply_markup: cancelKeyboard });
      } else {
        throw err;
      }
    }
    return true;
  }

  return false;
}
