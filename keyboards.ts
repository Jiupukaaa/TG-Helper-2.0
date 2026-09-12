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

export function noteItemKeyboard(noteId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ Изменить", `notes:edit:${noteId}`)
    .text("🗑 Удалить", `notes:delete:${noteId}`)
    .row()
    .text("⬅️ К списку", "notes:list");
}

export function reminderItemKeyboard(reminderId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑 Удалить", `reminders:delete:${reminderId}`)
    .row()
    .text("⬅️ К списку", "reminders:list");
}

export const cancelKeyboard = new InlineKeyboard().text("❌ Отмена", "session:cancel");

export function confirmDeleteKeyboard(kind: "note" | "reminder", id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Да, удалить", `${kind}s:delete_confirm:${id}`)
    .text("❌ Отмена", kind === "note" ? "notes:list" : "reminders:list");
}
