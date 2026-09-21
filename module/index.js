import EPshopSheet from "./shop-sheet.js";
import ShopModel from "./shop-model.js";
import { applyLoyaltyTransaction, completeShopPurchase, postShopChatMessage, shopRepIconHtml } from "./shop-logic.js";
import { registerPurchaseMode, purchaseModeList, applicablePurchaseModes, getPurchaseMode } from "./purchase-modes.js";
import { runShopMigration } from "./migration.js";
import "../tests/quench/index.js";

const MODULE_ID = "eclipsephase-shop";
const SHOP_TYPE = `${MODULE_ID}.shop`;
const LEGACY_SHOP_TYPE = "shop";
const REQUIRED_SYSTEM_VERSION = "2.5";
const SOCKET_NAME = "system.eclipsephase";
const BURN_BONUS_PER_POINT = 2;
// Same defaults the system derives a morph's tier from, applied here only when a shop overrides them.
const MORPH_TIER_THRESHOLDS = { moderate: 2, major: 5, rare: 8 };

const SHOP_TEMPLATES = [
  // The roll-dialog slot renders as a Handlebars partial, which is synchronous - it has to be
  // preloaded here or the slot finds nothing to render.
  "modules/eclipsephase-shop/templates/roll-dialog-section.html",
  "modules/eclipsephase-shop/templates/shop-footer.html",
  "modules/eclipsephase-shop/templates/shop-inventory-panel.html",
  "modules/eclipsephase-shop/templates/shop-to-sell-list.html"
];

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "migrationVersion", {
    config: false,
    scope: "world",
    type: String,
    default: ""
  });

  for (const key of ["enableFlatBuy", "enableMorphTrade"]) {
    game.settings.register(MODULE_ID, key, {
      config: true,
      scope: "world",
      name: `SETTINGS.${key}.name`,
      hint: `SETTINGS.${key}.hint`,
      type: Boolean,
      default: true,
      onChange: rerenderShopSheets
    });
  }

  registerCorePurchaseModes();

  CONFIG.Actor.dataModels[SHOP_TYPE] = ShopModel;
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, EPshopSheet, {
    types: [SHOP_TYPE],
    makeDefault: true
  });
  foundry.applications.handlebars.loadTemplates(SHOP_TEMPLATES);
});

/**
 * Re-renders every open shop sheet, so toggling a house rule takes effect without a reload.
 * @returns {void}
 */
function rerenderShopSheets() {
  for (const app of foundry.applications.instances.values()) {
    if (app instanceof EPshopSheet) app.render();
  }
}

/**
 * The payment routes the shop ships with. "Cash in Favor" and "Sell" are always available; "Buy"
 * is a house rule of this module, switchable in its own settings, and registers the same way an
 * outside module's route would.
 * @returns {void}
 */
function registerCorePurchaseModes() {
  registerPurchaseMode({
    id: "favor",
    label: "ep2e.shop.purchase.favorConfirm",
    order: 10,
    footerButton: "shop-purchase-favor",
    available: context => !context.isOwnerView && context.purchaseNetworks.length > 0,
    execute: context => context.sheet._useGefallen()
  });

  registerPurchaseMode({
    id: "sell",
    label: "ep2e.shop.toSell.confirm",
    order: 20,
    footerButton: "shop-cart-action",
    available: context => context.salesOpen,
    execute: context => context.sheet._confirmSellDialog()
  });

  registerPurchaseMode({
    id: "buy",
    label: "ep2e.shop.purchase.confirm",
    order: 30,
    footerButton: "shop-cart-action",
    available: () => game.settings.get(MODULE_ID, "enableFlatBuy") === true,
    execute: context => context.sheet._useFlatBuy()
  });
}

// Shops carry no health bars, so they get their own token defaults rather than the system's.
Hooks.on("preCreateActor", (actor, data) => {
  if (data.type !== SHOP_TYPE) return;
  actor.updateSource({
    "img": "systems/eclipsephase/resources/icons/Currency/currency-c.svg",
    "prototypeToken.displayName": CONST.TOKEN_DISPLAY_MODES.HOVER,
    "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.NEUTRAL,
    "prototypeToken.actorLink": false
  });
});

// Sell Bonus and burned Rep are the shop's own modifiers, and the burned amount has to reach the
// chat card so a pool rescue can still charge it. The payload is built once and stored twice:
// itemData feeds the chat card, flags.shop feeds the roll context the card keeps, which is the only
// route a later pool rescue can read. The system merges ctx.flags over its own block, so the shop
// owns that key outright.
Hooks.on("eclipsephase.preRoll", context => {
  if (context.rolledFrom !== "shopPurchase") return;
  const { dataset, options } = context;

  const sellBonus = Number(dataset.sellBonus) || 0;
  if (sellBonus) context.modifiers.push({ text: "ep2e.shop.purchase.sellBonusModifier", value: sellBonus });

  const burnAmount = Math.max(0, Math.min(
    Number(options.burnMod) || 0,
    Number(dataset.maxBurn) || 0,
    Number(dataset.rollvalue) || 0
  ));
  if (burnAmount) {
    context.modifiers.push({ text: "ep2e.shop.purchase.burnBonusModifier", value: burnAmount * BURN_BONUS_PER_POINT });
  }

  const payload = {
    shopUuid: dataset.shopUuid ?? "",
    buyerActorId: dataset.buyerActorId ?? "",
    itemIds: dataset.itemIds ?? "",
    network: dataset.name ?? "",
    requiredTier: dataset.requiredTier ?? "",
    bodyBindings: dataset.bodyBindings ?? "",
    burnAmount,
    redeemLevels: Math.max(0, Number(dataset.redeemLevels) || 0)
  };
  context.itemData = payload;
  context.flags.shop = payload;
});

// A pool spend that turns a failed purchase into a success completes the purchase after the fact.
// A card from before the shop stored its own block carries nothing to complete the purchase with,
// so the second guard lets those pass by untouched.
Hooks.on("eclipsephase.poolResult", async ({ context, actor }) => {
  if (context.rolledFrom !== "shopPurchase" || context.alternatives.resultClass !== "success") return;
  if (!context.shop?.shopUuid) return;

  const bodyBindings = {};
  (context.shop.bodyBindings || "").split(",").filter(Boolean).forEach(pair => {
    const [id, boundTo] = pair.split(":");
    bodyBindings[id] = boundTo;
  });

  const boughtItems = await completeShopPurchase({
    shopUuid: context.shop.shopUuid,
    buyerActorId: context.shop.buyerActorId,
    itemIds: context.shop.itemIds,
    network: context.shop.network,
    favorTier: context.shop.requiredTier,
    bodyBindings,
    redeemLevels: context.shop.redeemLevels ?? 0
  });
  if (!boughtItems.length) return;

  const burnAmount = context.shop.burnAmount;
  const tierLabel = `<span style="font-size: 16px;">${game.i18n.localize(CONFIG.eclipsephase.favorTiers[context.shop.requiredTier])}</span>`;
  const boxContent = burnAmount > 0
    ? `${tierLabel} + ${shopRepIconHtml(context.shop.network)} ${burnAmount}`
    : `${shopRepIconHtml(context.shop.network)} ${tierLabel}`;
  await postShopChatMessage(actor, burnAmount > 0 ? "ep2e.shop.purchase.favorBurnMessage" : "ep2e.shop.purchase.favorMessage",
    { character: actor.name, items: boughtItems.map(item => item.name).join(", "), network: context.shop.network.replace("-rep", "") },
    boxContent);
});

// A shop prices its stock by its own Morph Point thresholds, so a morph sitting in one can be
// worth a different tier than the same morph elsewhere.
Hooks.on("eclipsephase.prepareItemData", (item, itemModel) => {
  if (item.type !== "morph" || item.parent?.type !== SHOP_TYPE) return;
  const overrides = item.parent.system.morphPointOverrides;
  if (!overrides) return;

  const mp = Number(itemModel.morphPoints) || 0;
  const moderateMin = overrides.moderateMin ?? MORPH_TIER_THRESHOLDS.moderate;
  const majorMin = overrides.majorMin ?? MORPH_TIER_THRESHOLDS.major;
  const rareMin = overrides.rareMin ?? MORPH_TIER_THRESHOLDS.rare;
  if (mp >= rareMin) itemModel.cost = "rare";
  else if (mp >= majorMin) itemModel.cost = "major";
  else if (mp >= moderateMin) itemModel.cost = "moderate";
  else itemModel.cost = "minor";
});

Hooks.once("ready", async () => {
  const system = game.eclipsephase;
  if (!system || foundry.utils.isNewerVersion(REQUIRED_SYSTEM_VERSION, system.version)) {
    ui.notifications.error(game.i18n.format("ep2e.shop.warnings.systemTooOld", { required: REQUIRED_SYSTEM_VERSION }));
    return;
  }

  // Shop actors are usually GM-owned, so a buying player asks a GM to apply the loyalty change.
  game.socket.on(SOCKET_NAME, async payload => {
    if (payload?.action !== "grantLoyalty") return;
    if (!game.user.isGM) return;
    const primaryGM = game.users.activeGM;
    if (primaryGM && primaryGM.id !== game.user.id) return;
    const shop = await fromUuid(payload.shopUuid);
    if (!shop) return;
    await applyLoyaltyTransaction(shop, payload.characterId, payload.costTiers ?? [], payload.redeemLevels ?? 0);
  });

  await runShopMigration();
});

// What another module may build on. Mirrors the system's own approach: register rather than patch.
Hooks.once("init", () => {
  const module = game.modules.get(MODULE_ID);
  module.api = {
    registerPurchaseMode,
    purchaseModes: purchaseModeList,
    applicablePurchaseModes,
    getPurchaseMode,
    ShopModel,
    shopType: SHOP_TYPE
  };
});

Hooks.once("eclipsephase.ready", ({ api }) => {
  api.registry.registerRollSource("shopPurchase", {});
  api.registry.registerSlot("rollDialog.sections", {
    template: "modules/eclipsephase-shop/templates/roll-dialog-section.html",
    when: context => context.rolledFrom === "shopPurchase"
  });
});
