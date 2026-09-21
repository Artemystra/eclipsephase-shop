import { morphsBlocked } from "../../module/shop-logic.js";
import { resetWorld } from "../setup/factories.js";

/**
 * Loads the module afresh and runs its init hook, which is where the settings are registered.
 * @returns {void}
 */
function loadModule() {
  jest.isolateModules(() => {
    require("../../module/index.js");
  });
  Hooks.callAll("init");
}

/**
 * Asks the module's own API whether a route applies, so the test sees the same registry instance
 * the module loaded rather than a second copy of it.
 * @param {String} id - The mode id
 * @param {Object} context - The purchase context
 * @returns {Boolean} Whether the route is offered
 */
function routeAvailable(id, context) {
  const mode = game.modules.get("eclipsephase-shop").api.getPurchaseMode(id);
  return mode ? mode.available(context) === true : false;
}

/**
 * The purchase context for a shopper with something selected.
 * @returns {Object} The context
 */
function shopper() {
  return { isOwnerView: false, purchaseNetworks: ["i-rep"], hasSelection: true, hasStaged: false, salesOpen: true };
}

beforeEach(() => {
  resetWorld();
  loadModule();
});

describe("the module's house-rule settings", () => {
  test.each(["enableFlatBuy", "enableMorphTrade"])("%s is a world setting, shown in the UI and on by default", key => {
    const definition = game.settings.settings.get(`eclipsephase-shop.${key}`);
    expect(definition).toBeDefined();
    expect(definition.scope).toEqual("world");
    expect(definition.config).toBe(true);
    expect(definition.default).toBe(true);
    expect(game.settings.get("eclipsephase-shop", key)).toBe(true);
  });

  test("neither setting belongs to the system", () => {
    expect(game.settings.settings.has("eclipsephase.enableShopSystem")).toBe(false);
  });
});

describe("the Buy route follows its own setting", () => {
  test("it is offered while the setting is on", () => {
    expect(routeAvailable("buy", shopper())).toBe(true);
  });

  test("it disappears when the setting is off", async () => {
    await game.settings.set("eclipsephase-shop", "enableFlatBuy", false);
    expect(routeAvailable("buy", shopper())).toBe(false);
  });

  test("selling is unaffected by it", async () => {
    await game.settings.set("eclipsephase-shop", "enableFlatBuy", false);
    expect(routeAvailable("sell", shopper())).toBe(true);
  });
});

describe("morph trading follows its own setting", () => {
  const morphs = [{ type: "morph" }];
  const gear = [{ type: "gear" }];

  test("morphs pass while the setting is on", () => {
    expect(morphsBlocked(morphs)).toBe(false);
  });

  test("morphs are blocked when the setting is off", async () => {
    await game.settings.set("eclipsephase-shop", "enableMorphTrade", false);
    expect(morphsBlocked(morphs)).toBe(true);
  });

  test("a basket without a morph is never blocked", async () => {
    await game.settings.set("eclipsephase-shop", "enableMorphTrade", false);
    expect(morphsBlocked(gear)).toBe(false);
    expect(morphsBlocked([])).toBe(false);
  });

  test("the Buy setting does not block morphs on its own", async () => {
    await game.settings.set("eclipsephase-shop", "enableFlatBuy", false);
    expect(morphsBlocked(morphs)).toBe(false);
  });
});
