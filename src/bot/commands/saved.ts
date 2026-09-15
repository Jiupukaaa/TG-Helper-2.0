import { Composer, InlineKeyboard } from "grammy";
import { getOrCreateUser } from "@/bot/session";
import {
  createSavedGif,
  createSavedLink,
  createSavedPhoto,
  deleteSavedItem,
  detectSavedLink,
  getOwnedSavedItem,
  listSavedItems,
} from "@/services/savedService";
import { mainMenuKeyboard, savedDeleteSelectionKeyboard } from "@/bot/keyboards";

export const savedComposer = new Composer();

type SavedItem = { id: number; type: "LINK" | "PHOTO" | "GIF"; url: string | null; fileId: string | null };

function itemLabel(item: Pick<SavedItem, "type" | "url">, number: number): string {
  if (item.type === "LINK") return `#${number} 🔗 ${item.url}`;
  if (item.type === "PHOTO") return `#${number} 🖼️ Фото`;
  return `#${number} 🖼️ GIF`;
}

async function renderSavedList(ctx: any, userId: number, edit = true) {
  const items = await listSavedItems(userId);
  if (items.length === 0) {
    const text = "🔖 Сохраненки\n\nПока здесь ничего нет.\n\nОтправьте ссылку YouTube, TikTok или Twitch, фото либо GIF — я сохраню это сюда.";
    if (edit) await ctx.editMessageText(text, { reply_markup: mainMenuKeyboard });
    else await ctx.reply(text, { reply_markup: mainMenuKeyboard });
    return;
  }

  const lines = items.map((item, index) => itemLabel(item, index + 1));
  const keyboard = new InlineKeyboard();
  items.forEach((item, index) => {
    const number = index + 1;
    if (item.type === "LINK" && item.url) keyboard.row().url(`🔗 Открыть #${number}`, item.url);
    if (item.type === "PHOTO") keyboard.row().text(`🖼️ Отправить фото #${number}`, `saved:send:${item.id}`);
    if (item.type === "GIF") keyboard.row().text(`🖼️ Отправить GIF #${number}`, `saved:send:${item.id}`);
  });
  keyboard.row().text("🗑 Удалить", "saved:delete_mode").row().text("⬅️ В главное меню", "menu:main");

  const text = `🔖 Сохраненки:\n\n${lines.join("\n\n")}`;
  if (edit) await ctx.editMessageText(text, { reply_markup: keyboard });
  else await ctx.reply(text, { reply_markup: keyboard });
}

savedComposer.command("saved", async (ctx) => {
  const user = await getOrCreateUser(BigInt(ctx.from!.id));
  await renderSavedList(ctx, user.id, false);
});

savedComposer.callbackQuery("menu:saved", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await renderSavedList(ctx, user.id);
});

savedComposer.callbackQuery("saved:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  await renderSavedList(ctx, user.id);
});

savedComposer.callbackQuery(/^saved:send:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const item = await getOwnedSavedItem(user.id, Number(ctx.match[1]));
  if (!item?.fileId) {
    await ctx.reply("Сохраненный файл не найден.");
    return;
  }
  if (item.type === "PHOTO") await ctx.api.sendPhoto(ctx.chat!.id, item.fileId);
  else if (item.type === "GIF") await ctx.api.sendAnimation(ctx.chat!.id, item.fileId);
  else await ctx.reply("Этот элемент является ссылкой.");
});

savedComposer.callbackQuery("saved:delete_mode", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const items = await listSavedItems(user.id);
  if (items.length === 0) {
    await ctx.editMessageText("Сохраненок пока нет.", { reply_markup: mainMenuKeyboard });
    return;
  }
  const lines = items.map((item, index) => itemLabel(item, index + 1)).join("\n\n");
  await ctx.editMessageText(`🗑 Выберите номер сохраненки для удаления:\n\n${lines}`, {
    reply_markup: savedDeleteSelectionKeyboard(items),
  });
});

savedComposer.callbackQuery(/^saved:delete_select:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const id = Number(ctx.match[1]);
  const item = await getOwnedSavedItem(user.id, id);
  if (!item) {
    await ctx.editMessageText("Сохраненка не найдена или уже удалена.", { reply_markup: mainMenuKeyboard });
    return;
  }
  const items = await listSavedItems(user.id);
  const number = items.findIndex((entry) => entry.id === id) + 1;
  await ctx.editMessageText(`Удалить сохраненку #${number}? Это необратимо.`, {
    reply_markup: new InlineKeyboard()
      .text("✅ Да, удалить", `saved:delete_confirm:${id}`)
      .text("❌ Отмена", "saved:list"),
  });
});

savedComposer.callbackQuery(/^saved:delete_confirm:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getOrCreateUser(BigInt(ctx.from.id));
  const deleted = await deleteSavedItem(user.id, Number(ctx.match[1]));
  if (!deleted) {
    await ctx.editMessageText("Сохраненка не найдена или уже удалена.", { reply_markup: mainMenuKeyboard });
    return;
  }
  await renderSavedList(ctx, user.id);
});

export async function handleSavedTextInput(ctx: any, userId: number): Promise<boolean> {
  const text = ctx.message?.text as string | undefined;
  if (!text) return false;
  const url = detectSavedLink(text);
  if (!url) return false;

  const saved = await createSavedLink(userId, url);
  const items = await listSavedItems(userId);
  const number = items.findIndex((item) => item.id === saved.id) + 1;
  await ctx.reply(`🔖 Сохраненка #${number} сохранена.`, { reply_markup: mainMenuKeyboard });
  return true;
}

export async function handleSavedPhotoInput(ctx: any, userId: number): Promise<boolean> {
  const photo = ctx.message?.photo;
  if (!photo?.length) return false;
  const fileId = photo[photo.length - 1]!.file_id;
  const saved = await createSavedPhoto(userId, fileId);
  const items = await listSavedItems(userId);
  const number = items.findIndex((item) => item.id === saved.id) + 1;
  await ctx.reply(`🔖 Сохраненка #${number} — 🖼️ Фото сохранена.`, { reply_markup: mainMenuKeyboard });
  return true;
}

export async function handleSavedGifInput(ctx: any, userId: number): Promise<boolean> {
  const animation = ctx.message?.animation;
  if (!animation?.file_id) return false;
  const saved = await createSavedGif(userId, animation.file_id);
  const items = await listSavedItems(userId);
  const number = items.findIndex((item) => item.id === saved.id) + 1;
  await ctx.reply(`🔖 Сохраненка #${number} — 🖼️ GIF сохранен.`, { reply_markup: mainMenuKeyboard });
  return true;
}
