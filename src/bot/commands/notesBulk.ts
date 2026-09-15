import { Composer, InlineKeyboard } from "grammy";
import { getOrCreateUser } from "@/bot/session";
import { listNotes, deleteNote } from "@/services/notesService";

export const notesBulkComposer = new Composer();

notesBulkComposer.callbackQuery("notes:bulk", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const notes = await listNotes(user.id);
  if (!notes.length) { await ctx.editMessageText("У вас пока нет заметок."); return; }
  const k = new InlineKeyboard();
  notes.forEach((note, index) => { k.text(`☐ #${index + 1}`, `notes:bulk_toggle:${note.id}`); if (index % 2 === 1) k.row(); });
  if (notes.length % 2 === 1) k.row();
  k.text("❌ Отмена", "notes:list");
  await ctx.editMessageText("🗑 Выберите заметки для удаления:\n\nНажимайте на номера, чтобы отметить их.", { reply_markup: k });
});

notesBulkComposer.callbackQuery(/^notes:bulk_toggle:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const id = Number(ctx.match[1]);
  const { getSession, setSessionStep } = await import("@/bot/session");
  const session = await getSession(user.id);
  const draft = (session?.draft as { ids?: number[] } | null) ?? {};
  const ids = new Set(draft.ids ?? []);
  ids.has(id) ? ids.delete(id) : ids.add(id);
  await setSessionStep(user.id, "IDLE" as any, { ids: [...ids] });
  const notes = await listNotes(user.id);
  const k = new InlineKeyboard();
  notes.forEach((note, index) => { k.text(`${ids.has(note.id) ? "☑" : "☐"} #${index + 1}`, `notes:bulk_toggle:${note.id}`); if (index % 2 === 1) k.row(); });
  if (notes.length % 2 === 1) k.row();
  k.text(`🗑 Удалить выбранные (${ids.size})`, "notes:bulk_confirm").row().text("❌ Отмена", "notes:list");
  await ctx.editMessageText("🗑 Выберите заметки для удаления:", { reply_markup: k });
});

notesBulkComposer.callbackQuery("notes:bulk_confirm", async (ctx) => {
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const { getSession, clearSession } = await import("@/bot/session");
  const session = await getSession(user.id);
  const ids = ((session?.draft as { ids?: number[] } | null)?.ids ?? []);
  if (!ids.length) { await ctx.answerCallbackQuery({ text: "Ничего не выбрано.", show_alert: true }); return; }
  await ctx.answerCallbackQuery();
  let deleted = 0;
  for (const id of ids) if (await deleteNote(user.id, id)) deleted++;
  await clearSession(user.id);
  await ctx.editMessageText(`🗑 Удалено заметок: ${deleted}.`, { reply_markup: new InlineKeyboard().text("📝 К заметкам", "menu:notes").text("🏠 Главная", "menu:main") });
});
