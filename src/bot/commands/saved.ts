import { Composer, InlineKeyboard } from "grammy";
import { SessionStep } from "@/db/types";
import { getOrCreateUser, getSession, setSessionStep, clearSession } from "@/bot/session";
import {
  beginSavedComment, cancelSavedComment, countUnsortedSavedItems, createSavedGif, createSavedLink,
  createSavedPhoto, deleteSavedItem, detectSavedLink, getNextUnsortedSavedItem, getOwnedSavedItem,
  getSavedCommentSession, listSavedItems, savePendingSavedComment,
} from "@/services/savedService";

export const savedComposer = new Composer();
type SavedItem = { id: number; type: "LINK" | "PHOTO" | "GIF"; url: string | null; fileId: string | null; comment: string | null; sortedAt: Date | null };
type Filter = "ALL" | "LINK" | "PHOTO" | "GIF";

function itemLabel(item: Pick<SavedItem, "type" | "url">, number: number): string {
  if (item.type === "LINK") return "#" + number + " 🔗 " + item.url;
  if (item.type === "PHOTO") return "#" + number + " 🖼️ Фото";
  return "#" + number + " 🎞️ GIF";
}
function homeKeyboard() {
  return new InlineKeyboard()
    .text("🔄 Начать сортировку", "saved:sort:start").row()
    .text("📚 Все сохраненки", "saved:list").row()
    .text("⬅️ В главное меню", "menu:main");
}
async function renderSavedHome(ctx: any, edit = true) {
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const all = await listSavedItems(user.id);
  const pending = await countUnsortedSavedItems(user.id);
  const text = "🔖 Сохраненки\n\nВсего записей: " + all.length +
    "\nОжидают сортировки: " + pending +
    "\n\nВыберите действие:";
  if (edit) await ctx.editMessageText(text, { reply_markup: homeKeyboard() });
  else await ctx.reply(text, { reply_markup: homeKeyboard() });
}
function filterKeyboard(filter: Filter) {
  return new InlineKeyboard()
    .text(filter === "ALL" ? "✅ Все" : "Все", "saved:filter:ALL")
    .text(filter === "LINK" ? "✅ Ссылки" : "🔗 Ссылки", "saved:filter:LINK")
    .row()
    .text(filter === "PHOTO" ? "✅ Фото" : "🖼️ Фото", "saved:filter:PHOTO")
    .text(filter === "GIF" ? "✅ GIF" : "🎞️ GIF", "saved:filter:GIF");
}
async function renderSavedList(ctx: any, userId: number, edit = true, filter: Filter = "ALL") {
  const all = await listSavedItems(userId);
  const items = filter === "ALL" ? all : all.filter((item) => item.type === filter);
  if (all.length === 0) {
    const text = "🔖 Сохраненки\n\nПока здесь ничего нет.\n\nОтправьте ссылку YouTube, TikTok или Twitch, фото либо GIF — я сохраню это сюда.";
    const keyboard = new InlineKeyboard().text("⬅️ Назад", "menu:saved").row().text("⬅️ В главное меню", "menu:main");
    if (edit) await ctx.editMessageText(text, { reply_markup: keyboard }); else await ctx.reply(text, { reply_markup: keyboard });
    return;
  }
  const counts = "Всего: " + all.length + " · 🔗 " + all.filter((x) => x.type === "LINK").length +
    " · 🖼️ " + all.filter((x) => x.type === "PHOTO").length + " · 🎞️ " + all.filter((x) => x.type === "GIF").length;
  const lines = items.map((item) => {
    const number = all.findIndex((x) => x.id === item.id) + 1;
    return itemLabel(item, number) + (item.comment ? "\n💬 " + item.comment : "");
  });
  const keyboard = filterKeyboard(filter);
  items.forEach((item) => {
    const number = all.findIndex((x) => x.id === item.id) + 1;
    if (item.type === "PHOTO") keyboard.row().text("🖼️ Отправить фото #" + number, "saved:send:" + item.id);
    if (item.type === "GIF") keyboard.row().text("🎞️ Отправить GIF #" + number, "saved:send:" + item.id);
    keyboard.row().text((item.comment ? "✏️ Изменить комментарий #" : "💬 Добавить комментарий #") + number, "saved:comment:start:" + item.id);
  });
  keyboard.row().text("🗑 Удалить", "saved:delete_mode").text("🗑 Удалить несколько", "saved:bulk");
  keyboard.row().text("⬅️ Назад", "menu:saved").text("🏠 Главное меню", "menu:main");
  const text = "🔖 Сохраненки\n\n" + counts + "\nФильтр: " +
    (filter === "ALL" ? "Все" : filter === "LINK" ? "Ссылки" : filter === "PHOTO" ? "Фото" : "GIF") +
    "\n\n" + (lines.length ? lines.join("\n\n") : "В этой категории пока ничего нет.");
  if (edit) await ctx.editMessageText(text, { reply_markup: keyboard }); else await ctx.reply(text, { reply_markup: keyboard });
}
function savedItemKeyboard(itemId: number) {
  return new InlineKeyboard().text("💬 Добавить комментарий", "saved:comment:start:" + itemId);
}
async function showNextSortingItem(ctx: any, userId: number) {
  const item = await getNextUnsortedSavedItem(userId);
  const remaining = await countUnsortedSavedItems(userId);
  if (!item) {
    await ctx.reply("🎉 Сортировка завершена!\n\nВсе сохраненки обработаны.", {
      reply_markup: new InlineKeyboard().text("🔖 К сохраненкам", "menu:saved").text("🏠 Главное меню", "menu:main"),
    });
    return;
  }
  const number = (await listSavedItems(userId)).findIndex((entry) => entry.id === item.id) + 1;
  const keyboard = new InlineKeyboard()
    .text("❤️ Лайк", "saved:sort:like:" + item.id)
    .text("👎 Дизлайк", "saved:sort:dislike:" + item.id)
    .row()
    .text("⏹ Прекратить сортировку", "saved:sort:stop");
  const caption = "🔄 Сортировка · запись #" + number + "\nОсталось в очереди: " + remaining +
    (item.comment ? "\n\n💬 Текущий комментарий: " + item.comment : "");
  if (item.type === "PHOTO" && item.fileId) {
    await ctx.api.sendPhoto(ctx.chat!.id, item.fileId, { caption, reply_markup: keyboard });
  } else if (item.type === "GIF" && item.fileId) {
    await ctx.api.sendAnimation(ctx.chat!.id, item.fileId, { caption, reply_markup: keyboard });
  } else {
    await ctx.reply(caption + "\n\n" + (item.url ?? "Ссылка отсутствует."), { reply_markup: keyboard, link_preview_options: { is_disabled: false } });
  }
}

savedComposer.command("saved", async (ctx) => { await renderSavedHome(ctx, false); });
savedComposer.callbackQuery("menu:saved", async (ctx) => { await ctx.answerCallbackQuery(); await renderSavedHome(ctx, true); });
savedComposer.callbackQuery("saved:list", async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await renderSavedList(ctx, user.id); });
savedComposer.callbackQuery(/^saved:filter:(ALL|LINK|PHOTO|GIF)$/, async (ctx) => { await ctx.answerCallbackQuery(); const user = await getOrCreateUser(BigInt(ctx.from.id)); await renderSavedList(ctx, user.id, true, ctx.match[1] as Filter); });
savedComposer.callbackQuery("saved:sort:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await showNextSortingItem(ctx, user.id);
});
savedComposer.callbackQuery("saved:sort:stop", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await cancelSavedComment(user.id);
  await renderSavedHome(ctx, false);
});
savedComposer.callbackQuery(/^saved:sort:like:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const itemId = Number(ctx.match[1]);
  const started = await beginSavedComment(user.id, itemId, "SORT");
  if (!started) { await ctx.reply("Эта запись уже обработана или не найдена. Показываю следующую."); await showNextSortingItem(ctx, user.id); return; }
  await ctx.reply("❤️ Запись понравилась. Напишите комментарий, чтобы сохранить её и завершить сортировку.\n\nКомментарий обязателен.", {
    reply_markup: new InlineKeyboard().text("❌ Отмена комментария", "saved:comment:cancel").row().text("⏹ Прекратить сортировку", "saved:sort:stop"),
  });
});
savedComposer.callbackQuery(/^saved:sort:dislike:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const deleted = await deleteSavedItem(user.id, Number(ctx.match[1]));
  if (!deleted) { await ctx.reply("Запись уже удалена. Перехожу дальше."); }
  await showNextSortingItem(ctx, user.id);
});
savedComposer.callbackQuery(/^saved:comment:start:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const itemId = Number(ctx.match[1]);
  if (!await beginSavedComment(user.id, itemId, "ADD")) { await ctx.reply("Сохраненка не найдена."); return; }
  await ctx.reply("Введите комментарий к сохраненке:", {
    reply_markup: new InlineKeyboard().text("❌ Отмена", "saved:comment:cancel"),
  });
});
savedComposer.callbackQuery("saved:comment:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const session = await getSavedCommentSession(user.id);
  await cancelSavedComment(user.id);
  if (session?.mode === "SORT") {
    await ctx.reply("Комментарий отменён. Эта запись осталась в очереди сортировки.");
    await showNextSortingItem(ctx, user.id);
  } else {
    await ctx.reply("Добавление комментария отменено.");
  }
});
savedComposer.callbackQuery(/^saved:send:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const item = await getOwnedSavedItem(user.id, Number(ctx.match[1]));
  if (!item?.fileId) { await ctx.reply("Сохраненный файл не найден."); return; }
  if (item.type === "PHOTO") await ctx.api.sendPhoto(ctx.chat!.id, item.fileId);
  else if (item.type === "GIF") await ctx.api.sendAnimation(ctx.chat!.id, item.fileId);
  else await ctx.reply("Для этого элемента нет кнопки действия.");
});

savedComposer.callbackQuery("saved:delete_mode", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const items = await listSavedItems(user.id);
  if (!items.length) { await ctx.editMessageText("Сохраненок пока нет."); return; }
  const lines = items.map((item, index) => itemLabel(item, index + 1)).join("\n\n");
  const k = new InlineKeyboard();
  items.forEach((item, index) => { k.text("#" + (index + 1), "saved:delete_select:" + item.id); if (index % 2 === 1) k.row(); });
  if (items.length % 2 === 1) k.row();
  k.text("⬅️ К списку", "saved:list");
  await ctx.editMessageText("🗑 Выберите номер сохраненки для удаления:\n\n" + lines, { reply_markup: k });
});
savedComposer.callbackQuery(/^saved:delete_select:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const id = Number(ctx.match[1]);
  const item = await getOwnedSavedItem(user.id, id);
  if (!item) { await ctx.editMessageText("Сохраненка не найдена или уже удалена."); return; }
  const items = await listSavedItems(user.id);
  const number = items.findIndex((entry) => entry.id === id) + 1;
  await ctx.editMessageText("Удалить сохраненку #" + number + "?", {
    reply_markup: new InlineKeyboard().text("✅ Да, удалить", "saved:delete_confirm:" + id).text("❌ Отмена", "saved:list"),
  });
});
savedComposer.callbackQuery(/^saved:delete_confirm:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const deleted = await deleteSavedItem(user.id, Number(ctx.match[1]));
  await renderSavedList(ctx, user.id);
  if (!deleted) await ctx.reply("Сохраненка уже удалена.");
});
savedComposer.callbackQuery("saved:bulk", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const items = await listSavedItems(user.id);
  if (!items.length) { await ctx.editMessageText("Сохраненок пока нет."); return; }
  const k = new InlineKeyboard();
  items.forEach((item, index) => { k.text("☐ #" + (index + 1), "saved:bulk_toggle:" + item.id); if (index % 2 === 1) k.row(); });
  if (items.length % 2 === 1) k.row();
  k.text("❌ Отмена", "saved:list");
  await ctx.editMessageText("🗑 Выберите сохраненки для удаления:\n\nНажимайте на номера, чтобы отметить их.", { reply_markup: k });
});
savedComposer.callbackQuery(/^saved:bulk_toggle:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const id = Number(ctx.match[1]);
  const session = await getSession(user.id);
  const draft = (session?.draft as { ids?: number[] } | null) ?? {};
  const ids = new Set(draft.ids ?? []);
  ids.has(id) ? ids.delete(id) : ids.add(id);
  await setSessionStep(user.id, SessionStep.IDLE, { ids: Array.from(ids) });
  const items = await listSavedItems(user.id);
  const k = new InlineKeyboard();
  items.forEach((item, index) => { k.text((ids.has(item.id) ? "☑" : "☐") + " #" + (index + 1), "saved:bulk_toggle:" + item.id); if (index % 2 === 1) k.row(); });
  if (items.length % 2 === 1) k.row();
  k.text("🗑 Удалить выбранные (" + ids.size + ")", "saved:bulk_confirm").row().text("❌ Отмена", "saved:list");
  await ctx.editMessageText("🗑 Выберите сохраненки для удаления:", { reply_markup: k });
});
savedComposer.callbackQuery("saved:bulk_confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const session = await getSession(user.id);
  const ids = (session?.draft as { ids?: number[] } | null)?.ids ?? [];
  if (!ids.length) { await ctx.answerCallbackQuery({ text: "Ничего не выбрано.", show_alert: true }); return; }
  let deleted = 0;
  for (const id of ids) if (await deleteSavedItem(user.id, id)) deleted++;
  await clearSession(user.id);
  await ctx.editMessageText("🗑 Удалено сохраненок: " + deleted + ".", {
    reply_markup: new InlineKeyboard().text("🔖 К сохраненкам", "menu:saved").text("🏠 Главная", "menu:main"),
  });
});

export async function handleSavedTextInput(ctx: any, userId: number): Promise<boolean> {
  const text = ctx.message?.text as string | undefined;
  if (!text || text.startsWith("/")) return false;
  const pending = await getSavedCommentSession(userId);
  if (pending) {
    if (!text.trim()) { await ctx.reply("Комментарий не может быть пустым. Введите текст или отмените действие."); return true; }
    if (text.length > 1000) { await ctx.reply("Комментарий слишком длинный. Максимум — 1000 символов."); return true; }
    const result = await savePendingSavedComment(userId, text.trim());
    if (!result?.saved) { await ctx.reply("Не удалось сохранить комментарий: запись больше недоступна."); return true; }
    if (result.mode === "SORT") {
      await ctx.reply("✅ Комментарий сохранён. Запись добавлена в понравившиеся.");
      await showNextSortingItem(ctx, userId);
    } else {
      await ctx.reply("✅ Комментарий сохранён.");
    }
    return true;
  }
  const url = detectSavedLink(text);
  if (!url) return false;
  const saved = await createSavedLink(userId, url);
  const items = await listSavedItems(userId);
  const number = items.findIndex((item) => item.id === saved.id) + 1;
  await ctx.reply("🔖 Сохраненка #" + number + " сохранена.", { reply_markup: savedItemKeyboard(saved.id) });
  return true;
}
export async function handleSavedPhotoInput(ctx: any, userId: number): Promise<boolean> {
  const photo = ctx.message?.photo;
  if (!photo?.length) return false;
  if (await getSavedCommentSession(userId)) { await ctx.reply("Сейчас ожидаю текстовый комментарий. Отправьте его сообщением или отмените действие кнопкой."); return true; }
  const saved = await createSavedPhoto(userId, photo[photo.length - 1]!.file_id);
  const items = await listSavedItems(userId);
  const number = items.findIndex((item) => item.id === saved.id) + 1;
  await ctx.reply("🔖 Сохраненка #" + number + " — 🖼️ Фото сохранена.", { reply_markup: savedItemKeyboard(saved.id) });
  return true;
}
export async function handleSavedGifInput(ctx: any, userId: number): Promise<boolean> {
  const animation = ctx.message?.animation;
  if (!animation?.file_id) return false;
  if (await getSavedCommentSession(userId)) { await ctx.reply("Сейчас ожидаю текстовый комментарий. Отправьте его сообщением или отмените действие кнопкой."); return true; }
  const saved = await createSavedGif(userId, animation.file_id);
  const items = await listSavedItems(userId);
  const number = items.findIndex((item) => item.id === saved.id) + 1;
  await ctx.reply("🔖 Сохраненка #" + number + " — 🎞️ GIF сохранен.", { reply_markup: savedItemKeyboard(saved.id) });
  return true;
}

export async function handleSavedVoiceInput(ctx: any, userId: number): Promise<boolean> {
  if (!await getSavedCommentSession(userId)) return false;
  await ctx.reply("Сейчас ожидаю текстовый комментарий. Отправьте его сообщением или отмените действие кнопкой.");
  return true;
}

savedComposer.hears("🔖 Сохранёнки", async (ctx) => { await renderSavedHome(ctx, false); });
