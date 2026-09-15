import { InlineKeyboard } from "grammy";

export const mainMenuKeyboard = new InlineKeyboard()
  .text("📝 Заметки", "menu:notes")
  .text("⏰ Напоминания", "menu:reminders")
  .row()
  .text("📅 График работы", "menu:shifts")
  .row()
  .text("🔖 Сохраненки", "menu:saved");

export const notesMenuKeyboard = new InlineKeyboard()
  .text("➕ Новая заметка", "notes:new")
  .row()
  .text("📋 Все заметки", "notes:list")
  .row()
  .text("⬅️ Назад", "menu:main");

export const remindersMenuKeyboard = new InlineKeyboard()
  .text("➕ Новое напоминание", "reminders:new")
  .row()
  .text("📋 Все напоминания", "reminders:list")
  .row()
  .text("⬅️ В главное меню", "menu:main");

export function voiceNoteSavedKeyboard(noteId: number): InlineKeyboard {
  return new InlineKeyboard().text("🎙️ Перезаписать", `notes:voice_replace:${noteId}`);
}

export function notesListKeyboardWithVoiceActions(voiceNotes: Array<{ id: number; number: number }>): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("➕ Новая заметка", "notes:new");

  for (const note of voiceNotes) {
    keyboard.row().text(`🎙️ Отправить голосовое #${note.number}`, `notes:voice:${note.id}`);
  }

  keyboard
    .row()
    .text("🗑 Удалить", "notes:delete_mode")
    .row()
    .text("⬅️ К главному меню", "menu:main");

  return keyboard;
}

export function notesPaginationKeyboardWithVoiceActions(
  page: number,
  totalPages: number,
  voiceNotes: Array<{ id: number; number: number }>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (page > 0) keyboard.text("⬅️", `notes:list_page:${page - 1}`);
  if (page < totalPages - 1) keyboard.text("➡️", `notes:list_page:${page + 1}`);

  for (const note of voiceNotes) {
    keyboard.row().text(`🎙️ Отправить голосовое #${note.number}`, `notes:voice:${note.id}`);
  }

  keyboard
    .row()
    .text("➕ Новая заметка", "notes:new")
    .row()
    .text("🗑 Удалить", "notes:delete_mode")
    .row()
    .text("⬅️ К главному меню", "menu:main");
  return keyboard;
}

export const notesListKeyboard = new InlineKeyboard()
  .text("➕ Новая заметка", "notes:new")
  .row()
  .text("🗑 Удалить", "notes:delete_mode")
  .row()
  .text("⬅️ К главному меню", "menu:main");

export function notesPaginationKeyboard(page: number, totalPages: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (page > 0) keyboard.text("⬅️", `notes:list_page:${page - 1}`);
  if (page < totalPages - 1) keyboard.text("➡️", `notes:list_page:${page + 1}`);
  keyboard.row().text("➕ Новая заметка", "notes:new").row().text("🗑 Удалить", "notes:delete_mode").row().text("⬅️ К главному меню", "menu:main");
  return keyboard;
}

export const remindersListKeyboard = new InlineKeyboard()
  .text("🗑 Удалить", "reminders:delete_mode")
  .row()
  .text("⬅️ В главное меню", "menu:main");

export function savedListKeyboard(items: Array<{ id: number; type: "LINK" | "PHOTO" | "GIF" }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of items) {
    if (item.type === "LINK") keyboard.row().text(`🔗 Открыть #${item.id}`, `saved:open:${item.id}`);
    else if (item.type === "PHOTO") keyboard.row().text(`🖼️ Отправить фото #${item.id}`, `saved:send:${item.id}`);
    else keyboard.row().text(`🖼️ Отправить GIF #${item.id}`, `saved:send:${item.id}`);
  }
  keyboard.row().text("🗑 Удалить", "saved:delete_mode").row().text("⬅️ В главное меню", "menu:main");
  return keyboard;
}

export function savedDeleteSelectionKeyboard(items: Array<{ id: number }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  items.forEach((item, index) => {
    keyboard.text(`#${index + 1}`, `saved:delete_select:${item.id}`);
    if (index % 2 === 1) keyboard.row();
  });
  if (items.length % 2 === 1) keyboard.row();
  keyboard.text("⬅️ К списку", "saved:list");
  return keyboard;
}

export function savedListKeyboardWithLinks(items: Array<{ id: number; type: "LINK" | "PHOTO" | "GIF"; url: string | null }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of items) {
    if (item.type === "LINK" && item.url) keyboard.row().url(`🔗 Открыть #${item.number ?? item.id}`, item.url);
    else if (item.type === "PHOTO") keyboard.row().text(`🖼️ Отправить фото #${item.number ?? item.id}`, `saved:send:${item.id}`);
    else keyboard.row().text(`🖼️ Отправить GIF #${item.number ?? item.id}`, `saved:send:${item.id}`);
  }
  keyboard.row().text("🗑 Удалить", "saved:delete_mode").row().text("⬅️ В главное меню", "menu:main");
  return keyboard;
}

export function notesDeleteSelectionKeyboard(noteIds: number[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  noteIds.forEach((id, index) => {
    keyboard.text(`#${index + 1}`, `notes:delete_select:${id}`);
    if (index % 2 === 1) keyboard.row();
  });
  if (noteIds.length % 2 === 1) keyboard.row();
  keyboard.text("⬅️ К списку", "notes:list");
  return keyboard;
}

export function remindersDeleteSelectionKeyboard(reminderIds: number[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  reminderIds.forEach((id, index) => {
    keyboard.text(`#${index + 1}`, `reminders:delete_select:${id}`);
    if (index % 2 === 1) keyboard.row();
  });
  if (reminderIds.length % 2 === 1) keyboard.row();
  keyboard.text("⬅️ К списку", "reminders:list");
  return keyboard;
}

export function noteItemKeyboard(noteId: number, isVoice = false): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text("✏️ Изменить", `notes:edit:${noteId}`);
  if (isVoice) keyboard.row().text("🎙️ Отправить голосовое", `notes:voice:${noteId}`);
  keyboard.row().text("⬅️ К списку", "notes:list");
  return keyboard;
}

export function notePaginationKeyboard(noteId: number, page: number, totalPages: number, isVoice = false): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (page > 0) keyboard.text("⬅️", `notes:page:${noteId}:${page - 1}`);
  if (page < totalPages - 1) keyboard.text("➡️", `notes:page:${noteId}:${page + 1}`);
  keyboard.row().text("✏️ Изменить", `notes:edit:${noteId}`);
  if (isVoice) keyboard.row().text("🎙️ Отправить голосовое", `notes:voice:${noteId}`);
  keyboard.row().text("⬅️ К списку", "notes:list");
  return keyboard;
}

export function reminderItemKeyboard(reminderId: number): InlineKeyboard {
  return new InlineKeyboard().text("⬅️ К списку", "reminders:list");
}

export const cancelKeyboard = new InlineKeyboard().text("❌ Отмена", "session:cancel");

export function confirmDeleteKeyboard(kind: "note" | "reminder", id: number): InlineKeyboard {
  return new InlineKeyboard().text("✅ Да, удалить", `${kind}s:delete_confirm:${id}`).text("❌ Отмена", kind === "note" ? "notes:list" : "reminders:list");
}
