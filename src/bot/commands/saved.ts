import { Composer, InlineKeyboard } from "grammy";
import { getOrCreateUser } from "@/bot/session";
import { createSavedGif, createSavedLink, createSavedPhoto, deleteSavedItem, detectSavedLink, getOwnedSavedItem, listSavedItems } from "@/services/savedService";
import { mainMenuKeyboard } from "@/bot/keyboards";

export const savedComposer = new Composer();
type SavedItem = { id: number; type: "LINK" | "PHOTO" | "GIF"; url: string | null; fileId: string | null };
type Filter = "ALL" | "LINK" | "PHOTO" | "GIF";
function itemLabel(item: Pick<SavedItem, "type" | "url">, number: number): string {
  if (item.type === "LINK") return `#${number} 🔗 ${item.url}`;
  if (item.type === "PHOTO") return `#${number} 🖼️ Фото`;
  return `#${number} 🎞️ GIF`;
}
function filterKeyboard(filter: Filter) {
  const k = new InlineKeyboard()
    .text(filter === "ALL" ? "✅ Все" : "Все", "saved:filter:ALL")
    .text(filter === "LINK" ? "✅ Ссылки" : "🔗 Ссылки", "saved:filter:LINK")
    .row()
    .text(filter === "PHOTO" ? "✅ Фото" : "🖼️ Фото", "saved:filter:PHOTO")
    .text(filter === "GIF" ? "✅ GIF" : "🎞️ GIF", "saved:filter:GIF");
  return k;
}
async function renderSavedList(ctx: any, userId: number, edit = true, filter: Filter = "ALL") {
  const all = await listSavedItems(userId);
  const items = filter === "ALL" ? all : all.filter((item) => item.type === filter);
  if (all.length === 0) {
    const text = "🔖 Сохраненки\n\nПока здесь ничего нет.\n\nОтправьте ссылку YouTube, TikTok или Twitch, фото либо GIF — я сохраню это сюда.";
    if (edit) await ctx.editMessageText(text, { reply_markup: new InlineKeyboard().text("⬅️ В главное меню", "menu:main") });
    else await ctx.reply(text, { reply_markup: mainMenuKeyboard });
    return;
  }
  const counts = `Всего: ${all.length} · 🔗 ${all.filter((x) => x.type === "LINK").length} · 🖼️ ${all.filter((x) => x.type === "PHOTO").length} · 🎞️ ${all.filter((x) => x.type === "GIF").length}`;
  const lines = items.map((item) => itemLabel(item, all.findIndex((x) => x.id === item.id) + 1));
  const keyboard = filterKeyboard(filter);
  items.forEach((item) => {
    const number = all.findIndex((x) => x.id === item.id) + 1;
    if (item.type === "PHOTO") keyboard.row().text(`🖼️ Отправить фото #${number}`, `saved:send:${item.id}`);
    if (item.type === "GIF") keyboard.row().text(`🎞️ Отправить GIF #${number}`, `saved:send:${item.id}`);
  });
  keyboard.row().text("🗑 Удалить", "saved:delete_mode").text("🗑 Удалить несколько", "saved:bulk").row().text("⬅️ В главное меню", "menu:main");
  const text = `🔖 Сохраненки\n\n${counts}\nФильтр: ${filter === "ALL" ? "Все" : filter === "LINK" ? "Ссылки" : filter === "PHOTO" ? "Фото" : "GIF"}\n\n${lines.length ? lines.join("\n\n") : "В этой категории пока ничего нет."}`;
  if (edit) await ctx.editMessageText(text, { reply_markup: keyboard }); else await ctx.reply(text, { reply_markup: keyboard });
}

savedComposer.command("saved", async (ctx) => { const user = await getOrCreateUser(BigInt(ctx.from!.id)); await renderSavedList(ctx, user.id, false); });
savedComposer.callbackQuery("menu:saved", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await renderSavedList(ctx, user.id); });
savedComposer.callbackQuery(/^saved:filter:(ALL|LINK|PHOTO|GIF)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await renderSavedList(ctx, user.id, true, ctx.match[1] as Filter); });
savedComposer.callbackQuery("saved:list", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await renderSavedList(ctx, user.id); });
savedComposer.callbackQuery(/^saved:send:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const item = await getOwnedSavedItem(user.id, Number(ctx.match[1])); if (!item?.fileId) { await ctx.reply("Сохраненный файл не найден."); return; } if (item.type === "PHOTO") await ctx.api.sendPhoto(ctx.chat!.id, item.fileId); else if (item.type === "GIF") await ctx.api.sendAnimation(ctx.chat!.id, item.fileId); else await ctx.reply("Для этого элемента нет кнопки действия."); });

savedComposer.callbackQuery("saved:delete_mode", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const items = await listSavedItems(user.id); if (!items.length) { await ctx.editMessageText("Сохраненок пока нет.", { reply_markup: mainMenuKeyboard }); return; } const lines = items.map((item, index) => itemLabel(item, index + 1)).join("\n\n"); const k = new InlineKeyboard(); items.forEach((item, index) => { k.text(`#${index + 1}`, `saved:delete_select:${item.id}`); if (index % 2 === 1) k.row(); }); if (items.length % 2 === 1) k.row(); k.text("⬅️ К списку", "saved:list"); await ctx.editMessageText(`🗑 Выберите номер сохраненки для удаления:\n\n${lines}`, { reply_markup: k }); });
savedComposer.callbackQuery(/^saved:delete_select:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const id = Number(ctx.match[1]); const item = await getOwnedSavedItem(user.id, id); if (!item) { await ctx.editMessageText("Сохраненка не найдена или уже удалена.", { reply_markup: mainMenuKeyboard }); return; } const items = await listSavedItems(user.id); const number = items.findIndex((entry) => entry.id === id) + 1; await ctx.editMessageText(`Удалить сохраненку #${number}?`, { reply_markup: new InlineKeyboard().text("✅ Да, удалить", `saved:delete_confirm:${id}`).text("❌ Отмена", "saved:list") }); });
savedComposer.callbackQuery(/^saved:delete_confirm:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const deleted = await deleteSavedItem(user.id, Number(ctx.match[1])); await renderSavedList(ctx, user.id); if (!deleted) await ctx.reply("Сохраненка уже удалена."); });

savedComposer.callbackQuery("saved:bulk", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const items = await listSavedItems(user.id); if (!items.length) { await ctx.editMessageText("Сохраненок пока нет.", { reply_markup: mainMenuKeyboard }); return; } const k = new InlineKeyboard(); items.forEach((item, index) => { k.text(`☐ #${index + 1}`, `saved:bulk_toggle:${item.id}`); if (index % 2 === 1) k.row(); }); if (items.length % 2 === 1) k.row(); k.text("❌ Отмена", "saved:list"); await ctx.editMessageText("🗑 Выберите сохраненки для удаления:\n\nНажимайте на номера, чтобы отметить их.", { reply_markup: k }); });
savedComposer.callbackQuery(/^saved:bulk_toggle:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const id = Number(ctx.match[1]); const { getSession, setSessionStep } = await import("@/bot/session"); const session = await getSession(user.id); const draft = (session?.draft as { ids?: number[] } | null) ?? {}; const ids = new Set(draft.ids ?? []); ids.has(id) ? ids.delete(id) : ids.add(id); await setSessionStep(user.id, "IDLE" as any, { ids: [...ids] }); const items = await listSavedItems(user.id); const k = new InlineKeyboard(); items.forEach((item, index) => { k.text(`${ids.has(item.id) ? "☑" : "☐"} #${index + 1}`, `saved:bulk_toggle:${item.id}`); if (index % 2 === 1) k.row(); }); if (items.length % 2 === 1) k.row(); k.text(`🗑 Удалить выбранные (${ids.size})`, "saved:bulk_confirm").row().text("❌ Отмена", "saved:list"); await ctx.editMessageText("🗑 Выберите сохраненки для удаления:", { reply_markup: k }); });
savedComposer.callbackQuery("saved:bulk_confirm", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); const { getSession, clearSession } = await import("@/bot/session"); const session = await getSession(user.id); const ids = ((session?.draft as { ids?: number[] } | null)?.ids ?? []); if (!ids.length) { await ctx.answerCallbackQuery({ text: "Ничего не выбрано.", show_alert: true }); return; } let deleted = 0; for (const id of ids) if (await deleteSavedItem(user.id, id)) deleted++; await clearSession(user.id); await ctx.editMessageText(`🗑 Удалено сохраненок: ${deleted}.`, { reply_markup: new InlineKeyboard().text("🔖 К сохраненкам", "saved:list").text("🏠 Главная", "menu:main") }); });

export async function handleSavedTextInput(ctx: any, userId: number): Promise<boolean> { const text = ctx.message?.text as string | undefined; if (!text) return false; const url = detectSavedLink(text); if (!url) return false; const saved = await createSavedLink(userId, url); const items = await listSavedItems(userId); const number = items.findIndex((item) => item.id === saved.id) + 1; await ctx.reply(`🔖 Сохраненка #${number} сохранена.`, { reply_markup: mainMenuKeyboard }); return true; }
export async function handleSavedPhotoInput(ctx: any, userId: number): Promise<boolean> { const photo = ctx.message?.photo; if (!photo?.length) return false; const saved = await createSavedPhoto(userId, photo[photo.length - 1]!.file_id); const items = await listSavedItems(userId); const number = items.findIndex((item) => item.id === saved.id) + 1; await ctx.reply(`🔖 Сохраненка #${number} — 🖼️ Фото сохранена.`, { reply_markup: mainMenuKeyboard }); return true; }
export async function handleSavedGifInput(ctx: any, userId: number): Promise<boolean> { const animation = ctx.message?.animation; if (!animation?.file_id) return false; const saved = await createSavedGif(userId, animation.file_id); const items = await listSavedItems(userId); const number = items.findIndex((item) => item.id === saved.id) + 1; await ctx.reply(`🔖 Сохраненка #${number} — 🎞️ GIF сохранен.`, { reply_markup: mainMenuKeyboard }); return true; }
