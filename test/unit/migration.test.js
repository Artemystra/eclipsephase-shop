import { migrateShopActor } from "../../module/migration.js";
import ShopModel from "../../module/shop-model.js";

const SHOP_TYPE = "eclipsephase-shop.shop";

/**
 * A stand-in for a legacy shop actor that records the update it is asked to perform.
 * @param {Object} stored - What toObject() reports as the actor's system data
 * @param {Object} [behaviour] - throws to make update() reject, keepsType to make it change nothing
 * @returns {Object} The fake actor, carrying the recorded calls in updates
 */
function legacyActor(stored, { throws = false, keepsType = false } = {}) {
  return {
    name: "Fake Shop",
    type: "shop",
    updates: [],
    toObject() {
      return { system: stored };
    },
    async update(data) {
      this.updates.push(data);
      if (throws) throw new Error("update refused");
      if (!keepsType) this.type = data.type;
    }
  };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("moving one shop onto the module's type", () => {
  test("it reports success once the actor carries the new type", async () => {
    const actor = legacyActor({ loyaltyBarMax: 77 });
    expect(await migrateShopActor(actor)).toBe(true);
    expect(actor.type).toEqual(SHOP_TYPE);
  });

  test("the type is written before the system data", async () => {
    const actor = legacyActor({ loyaltyBarMax: 77 });
    await migrateShopActor(actor);
    expect(Object.keys(actor.updates[0])).toEqual(["type", "system"]);
  });

  test("the system data travels as a forced replacement", async () => {
    const actor = legacyActor({ loyaltyBarMax: 77 });
    await migrateShopActor(actor);
    expect(actor.updates[0].system).toBeInstanceOf(ForcedReplacement);
  });

  test("the replacement keeps the stored values and fills in the rest", async () => {
    const actor = legacyActor({ loyaltyBarMax: 77, acceptsSales: false });
    await migrateShopActor(actor);
    const { value } = actor.updates[0].system;
    expect(value.loyaltyBarMax).toEqual(77);
    expect(value.acceptsSales).toBe(false);
    expect(value.schemaVersion).toEqual(1);
    expect(value.sellLimitMaxItems).toEqual(0);
  });

  test("data the model cleans to itself is refused without an update", async () => {
    const actor = legacyActor(ShopModel.cleanData());
    expect(await migrateShopActor(actor)).toBe(false);
    expect(actor.updates).toEqual([]);
  });

  test("a throwing update is reported as a failure", async () => {
    const actor = legacyActor({ loyaltyBarMax: 77 }, { throws: true });
    expect(await migrateShopActor(actor)).toBe(false);
  });

  test("an update that silently leaves the type alone is reported as a failure", async () => {
    const actor = legacyActor({ loyaltyBarMax: 77 }, { keepsType: true });
    expect(await migrateShopActor(actor)).toBe(false);
  });
});
