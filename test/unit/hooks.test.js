import { makeShop, makeCustomer, resetWorld } from "../setup/factories.js";

jest.mock("../../module/shop-logic.js", () => {
  const actual = jest.requireActual("../../module/shop-logic.js");
  return {
    ...actual,
    completeShopPurchase: jest.fn(async () => []),
    postShopChatMessage: jest.fn(async () => {}),
    shopRepIconHtml: jest.fn(() => "<img/>")
  };
});

const shopLogic = require("../../module/shop-logic.js");
const { hookHandlers } = global.__shop;

/**
 * Loads the module afresh and runs its init hook, so every registration happens the way it does on
 * a world load. resetWorld() clears the hook table, so this has to run per test.
 * @returns {void}
 */
function loadModule() {
  jest.isolateModules(() => {
    require("../../module/index.js");
  });
  Hooks.callAll("init");
}

/**
 * Fires one hook straight at the module's own handlers.
 * @param {String} event - The hook name
 * @param {...*} args - The hook arguments
 * @returns {void}
 */
function fire(event, ...args) {
  for (const handler of hookHandlers.get(event) ?? []) handler(...args);
}

/**
 * The roll context RollCheck hands to eclipsephase.preRoll for a shop purchase.
 * @param {Object} [dataset] - Fields merged into the dataset
 * @param {Object} [options] - Fields merged into the dialog options
 * @returns {Object} The context
 */
function preRollContext(dataset = {}, options = {}) {
  return {
    rolledFrom: "shopPurchase",
    modifiers: [],
    flags: {},
    itemData: null,
    dataset: {
      name: "i-rep",
      rollvalue: 50,
      shopUuid: "Actor.shop0001",
      buyerActorId: "buyer0001",
      itemIds: "item0001",
      requiredTier: "moderate",
      bodyBindings: "",
      sellBonus: 0,
      maxBurn: 15,
      ...dataset
    },
    options: { burnMod: 0, ...options }
  };
}

beforeEach(() => {
  resetWorld();
  shopLogic.completeShopPurchase.mockClear();
  shopLogic.postShopChatMessage.mockClear();
  loadModule();
});

describe("the preRoll hook", () => {
  test("a Sell Bonus becomes a roll modifier", () => {
    const context = preRollContext({ sellBonus: 20 });
    fire("eclipsephase.preRoll", context);
    expect(context.modifiers).toContainEqual({ text: "ep2e.shop.purchase.sellBonusModifier", value: 20 });
  });

  test("burned Rep counts double and is clamped to maxBurn", () => {
    const context = preRollContext({ maxBurn: 15 }, { burnMod: 99 });
    fire("eclipsephase.preRoll", context);
    expect(context.modifiers).toContainEqual({ text: "ep2e.shop.purchase.burnBonusModifier", value: 30 });
    expect(context.itemData.burnAmount).toEqual(15);
  });

  test("burned Rep is also clamped to the rep the character actually has", () => {
    const context = preRollContext({ maxBurn: 15, rollvalue: 4 }, { burnMod: 10 });
    fire("eclipsephase.preRoll", context);
    expect(context.itemData.burnAmount).toEqual(4);
  });

  test("neither modifier appears without a bonus or a burn", () => {
    const context = preRollContext();
    fire("eclipsephase.preRoll", context);
    expect(context.modifiers).toEqual([]);
  });

  test("the purchase payload carries every field the pool rescue needs", () => {
    const context = preRollContext({ bodyBindings: "item1:morph1" });
    fire("eclipsephase.preRoll", context);
    expect(context.itemData).toMatchObject({
      shopUuid: "Actor.shop0001",
      buyerActorId: "buyer0001",
      itemIds: "item0001",
      network: "i-rep",
      requiredTier: "moderate",
      bodyBindings: "item1:morph1",
      burnAmount: 0
    });
  });


  test("the eased loyalty levels ride along in the stored chat context", () => {
    const context = preRollContext({ redeemLevels: 2 });
    fire("eclipsephase.preRoll", context);
    expect(context.flags.shop).toMatchObject({ shopUuid: "Actor.shop0001", redeemLevels: 2 });
    expect(context.itemData.redeemLevels).toEqual(2);
  });

  test("no ease means no levels to redeem", () => {
    const context = preRollContext();
    fire("eclipsephase.preRoll", context);
    expect(context.flags.shop.redeemLevels).toEqual(0);
  });

  test("the stored block carries the same fields the card does", () => {
    const context = preRollContext({ bodyBindings: "itemA:morphA", redeemLevels: 1 });
    fire("eclipsephase.preRoll", context);
    expect(context.flags.shop).toEqual(context.itemData);
  });

  test("a roll from another source is left alone", () => {
    const context = preRollContext({ sellBonus: 20 });
    context.rolledFrom = "skill";
    fire("eclipsephase.preRoll", context);
    expect(context.modifiers).toEqual([]);
    expect(context.itemData).toBeNull();
  });
});

describe("the poolResult hook", () => {
  /**
   * The chat context a rescued shop roll carries.
   * @param {Object} [shop] - Fields merged into the stored shop block
   * @param {String} [resultClass] - The rescued roll's outcome
   * @returns {Object} The hook argument
   */
  function poolResult(shop = {}, resultClass = "success") {
    return {
      context: {
        rolledFrom: "shopPurchase",
        alternatives: { resultClass },
        shop: {
          shopUuid: "Actor.shop0001",
          buyerActorId: "buyer0001",
          itemIds: "item0001",
          network: "i-rep",
          requiredTier: "moderate",
          bodyBindings: "",
          burnAmount: 0,
          ...shop
        }
      },
      actor: makeCustomer()
    };
  }

  test("a rescued success completes the purchase", async () => {
    fire("eclipsephase.poolResult", poolResult());
    await Promise.resolve();
    expect(shopLogic.completeShopPurchase).toHaveBeenCalledWith(expect.objectContaining({
      shopUuid: "Actor.shop0001",
      itemIds: "item0001",
      favorTier: "moderate"
    }));
  });

  test("a rescue that still failed buys nothing", async () => {
    fire("eclipsephase.poolResult", poolResult({}, "fail"));
    await Promise.resolve();
    expect(shopLogic.completeShopPurchase).not.toHaveBeenCalled();
  });

  test("a roll from another source buys nothing", async () => {
    const argument = poolResult();
    argument.context.rolledFrom = "skill";
    fire("eclipsephase.poolResult", argument);
    await Promise.resolve();
    expect(shopLogic.completeShopPurchase).not.toHaveBeenCalled();
  });


  test("a rescued favor consumes the loyalty it was eased with", async () => {
    fire("eclipsephase.poolResult", poolResult({ redeemLevels: 2 }));
    await Promise.resolve();
    expect(shopLogic.completeShopPurchase).toHaveBeenCalledWith(expect.objectContaining({ redeemLevels: 2 }));
  });

  test("a rescued favor without ease still grants the normal loyalty", async () => {
    fire("eclipsephase.poolResult", poolResult());
    await Promise.resolve();
    expect(shopLogic.completeShopPurchase).toHaveBeenCalledWith(expect.objectContaining({ redeemLevels: 0 }));
  });

  test("a card from before this field existed is ignored instead of throwing", async () => {
    const argument = poolResult();
    delete argument.context.shop;
    expect(() => fire("eclipsephase.poolResult", argument)).not.toThrow();
    await Promise.resolve();
    expect(shopLogic.completeShopPurchase).not.toHaveBeenCalled();
  });

  test("body bindings are unpacked back into a map", async () => {
    fire("eclipsephase.poolResult", poolResult({ bodyBindings: "itemA:morphA,itemB:morphB" }));
    await Promise.resolve();
    expect(shopLogic.completeShopPurchase).toHaveBeenCalledWith(expect.objectContaining({
      bodyBindings: { itemA: "morphA", itemB: "morphB" }
    }));
  });
});

describe("the prepareItemData hook", () => {
  test("a shop's own thresholds price its stock", () => {
    const shop = makeShop({ system: { morphPointOverrides: { moderateMin: 10, majorMin: 20, rareMin: 30 } } });
    const item = { type: "morph", parent: shop };
    const model = { morphPoints: 8 };

    fire("eclipsephase.prepareItemData", item, model);

    expect(model.cost).toEqual("minor");
  });

  test("a morph outside a shop is left to the system's own tiers", () => {
    const item = { type: "morph", parent: makeCustomer() };
    const model = { morphPoints: 8 };

    fire("eclipsephase.prepareItemData", item, model);

    expect(model.cost).toBeUndefined();
  });

  test("a shop without overrides is left alone", () => {
    const shop = makeShop();
    shop.system.morphPointOverrides = null;
    const item = { type: "morph", parent: shop };
    const model = { morphPoints: 8 };

    fire("eclipsephase.prepareItemData", item, model);

    expect(model.cost).toBeUndefined();
  });
});

describe("the morph thresholds the module falls back on", () => {
  test("match the ones the system derives a morph's tier from", () => {
    // The module keeps its own copy so it never imports from the system. If the system ever moves
    // its thresholds, this is what says so rather than a shop quietly pricing stock differently.
    const source = require("fs").readFileSync(require("path").resolve(__dirname, "..", "..", "module", "index.js"), "utf8");
    const declared = source.match(/const MORPH_TIER_THRESHOLDS = (\{[^}]+\})/);
    expect(declared).not.toBeNull();
    // eslint-disable-next-line no-eval
    expect(eval(`(${declared[1]})`)).toEqual({ moderate: 2, major: 5, rare: 8 });
  });
});
