import ShopModel from "./shop-model.js";
import { lockedStock } from "./stock.js";

const MODULE_ID = "eclipsephase-shop";
const SHOP_TYPE = `${MODULE_ID}.shop`;
const LEGACY_SHOP_TYPE = "shop";
const GENERAL_CHAT_MESSAGE = "systems/eclipsephase/templates/chat/general-chat-message.html";

/**
 * Moves one legacy shop actor onto this module's own type, keeping its id so scene tokens still
 * resolve. Changing a type demands that the system data come along as a forced replacement, and
 * that replacement has to differ from what is stored: the server has no data model for a module
 * sub-type, so it drops a replacement equal to the stored value, and the client then rejects a
 * type change that came back without one. ShopModel's schemaVersion guarantees the difference;
 * the guard below refuses rather than leave the server holding a type the client threw on.
 * The type must be written before the system data, because the client picks the data model from
 * the type it has already applied. A failed type change can either throw or pass silently, so the
 * result is judged by the type the document actually carries afterwards.
 * @param {Actor} actor - The legacy shop actor
 * @returns {Promise<Boolean>} Whether the actor now carries this module's type
 */
export async function migrateShopActor(actor) {
  const stored = actor.toObject().system ?? {};
  const replacement = ShopModel.cleanData(stored);
  if (foundry.utils.equals(replacement, stored)) {
    console.error(`Eclipse Phase Shops | "${actor.name}" stores exactly what the model cleans it to, so the replacement would be dropped.`);
    return false;
  }
  try {
    await actor.update({ type: SHOP_TYPE, system: _replace(replacement) });
  } catch (error) {
    console.error(`Eclipse Phase Shops | "${actor.name}" could not be migrated:`, error);
    return false;
  }
  return actor.type === SHOP_TYPE;
}

/**
 * Tells the GMs which shops still stock a drug offering several forms. A pack holds one form since
 * system 2.7, and such a drug cannot be bought until the GM settles its form on the stock item.
 * @returns {Promise<ChatMessage|null>} The notice, or null when no shop is affected
 */
export async function noticeDrugsWithoutForm() {
  const lines = game.actors
    .filter(actor => actor.type === SHOP_TYPE)
    .map(shop => ({ shop, names: Object.keys(lockedStock(shop)).map(id => shop.items.get(id)?.name).filter(Boolean) }))
    .filter(entry => entry.names.length)
    .map(entry => `<b>${entry.shop.name}</b>: ${entry.names.join(", ")}`);
  if (!lines.length) return null;

  const content = await foundry.applications.handlebars.renderTemplate(GENERAL_CHAT_MESSAGE, {
    type: "general",
    headline: game.i18n.localize("ep2e.shop.migration.drugFormHeadline"),
    boxDetail: [game.i18n.localize("ep2e.shop.migration.drugFormDetail"), ...lines].join("<br>")
  });
  return ChatMessage.create({ content, whisper: ChatMessage.getWhisperRecipients("GM").map(user => user.id) });
}

/**
 * Converts every legacy shop actor in the world, and names the drugs left without a form, once per
 * module version.
 * @returns {Promise<void>} Resolves once the migration has run or was skipped
 */
export async function runShopMigration() {
  if (!game.user.isGM) return;
  if (game.settings.get(MODULE_ID, "migrationVersion") === game.modules.get(MODULE_ID).version) return;

  const legacy = game.actors.filter(actor => actor.type === LEGACY_SHOP_TYPE);
  if (legacy.length) {
    const failed = [];
    for (const actor of legacy) {
      if (!(await migrateShopActor(actor))) failed.push(actor.name);
    }
    if (failed.length) {
      ui.notifications.error(game.i18n.format("ep2e.shop.migration.failed", { shops: failed.join(", ") }));
      return;
    }
    ui.notifications.info(game.i18n.format("ep2e.shop.migration.done", { count: legacy.length }));
  }
  await noticeDrugsWithoutForm();

  await game.settings.set(MODULE_ID, "migrationVersion", game.modules.get(MODULE_ID).version);
}
