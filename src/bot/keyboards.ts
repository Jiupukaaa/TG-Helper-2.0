import { InlineKeyboard } from "grammy";

export const mainMenuKeyboard = new InlineKeyboard()
  .text("📝 Заметки", "menu:notes")
  .text("⏰ Напоминания", "menu:reminders");

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
  .text("⬅️ Назад", "menu:main");

export const notesListKeyboard = new InlineKeyboard()
  .text("🗑 Удалить", "notes:delete_mode")
  .row()
  .text("⬅️ К меню заметок", "menu:notes");

export const remindersListKeyboard = new InlineKeyboard()
  .text("🗑 Удалить", "reminders:delete_mode")
  .row()
  .text("⬅️ К меню напоминаний", "menu:reminders");

export function notesDeleteSelectionKeyboard(noteIds: number[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  noteIds.forEach((id, index) => {
    keyboard.text(`#${id}`, `notes:delete_select:${id}`);
    if (index % 2 === 1) keyboard.row();
  });
  if (noteIds.length % 2 === 1) keyboard.row();
  keyboard.text("⬅️ К списку", "notes:list");
  return keyboard;
}

export function remindersDeleteSelectionKeyboard(reminderIds: number[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  reminderIds.forEach((id, index) => {
    keyboard.text(`#${id}`, `reminders:delete_select:${id}`);
    if (index % 2 === 1) keyboard.row();
  });
  if (reminderIds.length % 2 === 1) keyboard.row();
  keyboard.text("⬅️ К списку", "reminders:list");
  return keyboard;
}

export function noteItemKeyboard(noteId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ Изменить", `notes:edit:${noteId}`)
    .row()
    .text("⬅️ К списку", "notes:list");
}

export function reminderItemKeyboard(reminderId: number): InlineKeyboard {
  return new InlineKeyboard().text("⬅️ К списку", "reminders:list");
}

export const cancelKeyboard = new InlineKeyboard().text("❌ Отмена", "session:cancel");

export function confirmDeleteKeyboard(kind: "note" | "reminder", id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Да, удалить", `${kind}s:delete_confirm:${id}`)
    .text("❌ Отмена", kind === "note" ? "notes:list" : "reminders:list");
}
