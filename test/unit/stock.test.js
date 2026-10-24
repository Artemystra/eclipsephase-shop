import { availableUnits, drugFormLabel, setStockQuantity, stockItem, lockedStock, setSelectedCount, toggleSelected, selectionUnits, countIds, unitSummary, DRUG_FORM_UNSET } from "../../module/stock.js";
import { completeShopPurchase } from "../../module/shop-logic.js";
import { noticeDrugsWithoutForm } from "../../module/migration.js";
import { makeShop, makeCustomer, resetWorld } from "../setup/factories.js";

const FORMS = ["dermal", "inhalation", "injection", "oral"];

/**
 * Stands in for the system's drug and stack API with the same rules: a drug offering several forms
 * still needs one chosen, a stack joins a row of the same type and name, a transfer moves units.
 * @param {Object} [answer] - What the form dialog answers: a form key, or null for cancelled
 * @returns {Object} The recorded calls
 */
function stubSystemApi({ answer = "oral" } = {}) {
  const calls = { chooseDrugForm: [], mergeOrCreateItem: [], transfers: [] };
  game.eclipsephase.api.drugs = {
    needsVectorChoice: system => FORMS.filter(key => system?.[key]).length > 1,
    isAmmoPack: system => system?.isAmmo === true,
    drugVector: system => {
      const forms = FORMS.filter(key => system?.[key]);
      return forms.length === 1 ? { key: forms[0], label: `form.${forms[0]}` } : null;
    },
    chooseDrugForm: async data => {
      calls.chooseDrugForm.push(data.name);
      if (data.type !== "drug" || FORMS.filter(key => data.system[key]).length < 2) return true;
      if (!answer) return false;
      for (const key of FORMS) data.system[key] = key === answer;
      return true;
    }
  };
  game.eclipsephase.api.actors = {
    mergeOrCreateItem: async (actor, data) => {
      calls.mergeOrCreateItem.push(data.name);
      const row = actor.items.find(item => item.type === data.type && item.name === data.name);
      if (!row) return (await actor.createEmbeddedDocuments("Item", [data]))[0];
      await row.update({ "system.quantity": row.system.quantity + (data.system.quantity ?? 1) });
      return row;
    },
    transferItemBetweenActors: async ({ sourceActor, targetActor, item, quantity }) => {
      calls.transfers.push({ name: item.name, quantity });
      const [created] = await targetActor.createEmbeddedDocuments("Item", [{ ...item.toObject(), system: { ...item.system, quantity } }]);
      if (item.system.quantity <= quantity) await sourceActor.deleteEmbeddedDocuments("Item", [item.id]);
      else await item.update({ "system.quantity": item.system.quantity - quantity });
      return created;
    }
  };
  return calls;
}

const grenade = (id, quantity) => ({ _id: id, name: "Frag Grenade", type: "grenade", system: { quantity, cost: "minor" } });
const grin = (id, forms) => ({ _id: id, name: "Grin", type: "drug", system: { quantity: 1, ...Object.fromEntries(forms.map(key => [key, true])) } });

describe("stocking the shop", () => {
  beforeEach(() => resetWorld());

  test("a drug offering several forms is settled to the one chosen before it is stocked", async () => {
    stubSystemApi({ answer: "oral" });
    const shop = makeShop();

    const row = await stockItem(shop, grin(undefined, ["injection", "oral"]));

    expect(row.system).toMatchObject({ oral: true, injection: false });
    expect(shop.items.size).toBe(1);
  });

  test("a cancelled form choice stocks nothing", async () => {
    stubSystemApi({ answer: null });
    const shop = makeShop();

    expect(await stockItem(shop, grin(undefined, ["injection", "oral"]))).toBeNull();
    expect(shop.items.size).toBe(0);
  });

  test("the same stack dropped again grows its row instead of adding one", async () => {
    stubSystemApi();
    const shop = makeShop();

    await stockItem(shop, grenade(undefined, 1));
    await stockItem(shop, grenade(undefined, 1));
    await stockItem(shop, grenade(undefined, 1));

    expect(shop.items.size).toBe(1);
    expect(shop.items.contents[0].system.quantity).toBe(3);
  });

  test("an item without a quantity gets a row of its own every time", async () => {
    const calls = stubSystemApi();
    const shop = makeShop();
    const rifle = { name: "Rail Rifle", type: "rangedWeapon", system: {} };

    await stockItem(shop, { ...rifle });
    await stockItem(shop, { ...rifle });

    expect(shop.items.size).toBe(2);
    expect(calls.mergeOrCreateItem).toEqual([]);
  });
});

describe("what the shop has on offer", () => {
  beforeEach(() => resetWorld());

  test("a stack offers its quantity, anything else one", () => {
    const shop = makeShop({ items: [grenade("gren0001", 4), { _id: "rifle001", name: "Rail Rifle", type: "rangedWeapon", system: {} }] });

    expect(availableUnits(shop.items.get("gren0001"))).toBe(4);
    expect(availableUnits(shop.items.get("rifle001"))).toBe(1);
  });

  test("only a drug still offering several forms is locked, with the reason", () => {
    stubSystemApi();
    const shop = makeShop({ items: [grin("grin0001", ["injection", "oral"]), grin("grin0002", ["oral"]), grenade("gren0001", 2)] });

    expect(lockedStock(shop)).toEqual({ grin0001: DRUG_FORM_UNSET });
  });
});

describe("what a stock row shows and the owner sets", () => {
  beforeEach(() => resetWorld());

  test("a drug row names its one form, or ammunition, and nothing while its form is unset", () => {
    stubSystemApi();
    const shop = makeShop({ items: [grin("grin0001", ["oral"]), { ...grin("grin0002", ["injection"]), system: { injection: true, isAmmo: true } }, grin("grin0003", ["injection", "oral"]), grenade("gren0001", 1)] });

    expect(drugFormLabel(shop.items.get("grin0001"))).toBe("form.oral");
    expect(drugFormLabel(shop.items.get("grin0002"))).toBe("ep2e.shop.inventory.ammoForm");
    expect(drugFormLabel(shop.items.get("grin0003"))).toBeNull();
    expect(drugFormLabel(shop.items.get("gren0001"))).toBeNull();
  });

  test("the owner's stock count is stored as a whole number and never drops below one", async () => {
    const shop = makeShop({ items: [grenade("gren0001", 3)] });
    const item = shop.items.get("gren0001");

    expect(await setStockQuantity(item, "7")).toBe(7);
    expect(await setStockQuantity(item, "0")).toBe(1);
    expect(item.system.quantity).toBe(1);
  });
});

describe("picking how many to buy", () => {
  beforeEach(() => resetWorld());

  test("the count stays between nothing and what is in stock, and nothing drops the row", () => {
    const shop = makeShop({ items: [grenade("gren0001", 3)] });
    const item = shop.items.get("gren0001");
    const selection = new Map();

    expect(setSelectedCount(selection, item, 5)).toBe(3);
    expect(setSelectedCount(selection, item, "-2")).toBe(0);
    expect(selection.has("gren0001")).toBe(false);
  });

  test("the cart toggle puts a single unit in and takes it out again", () => {
    const shop = makeShop({ items: [grenade("gren0001", 1)] });
    const item = shop.items.get("gren0001");
    const selection = new Map();

    expect(toggleSelected(selection, item)).toBe(1);
    expect(selection.get("gren0001")).toBe(1);
    expect(toggleSelected(selection, item)).toBe(0);
    expect(selection.has("gren0001")).toBe(false);
  });

  test("the selection counts once per unit, leaving out rows gone or locked since", () => {
    stubSystemApi();
    const shop = makeShop({ items: [grenade("gren0001", 3), grin("grin0001", ["injection", "oral"])] });
    const selection = new Map([["gren0001", 2], ["grin0001", 1], ["gone0001", 1]]);

    const units = selectionUnits(shop, selection);

    expect(units.map(item => item.id)).toEqual(["gren0001", "gren0001"]);
  });

  test("ids carried once per unit count back up, and a summary names each once", () => {
    expect([...countIds(["a", "b", "a"])]).toEqual([["a", 2], ["b", 1]]);
    expect(unitSummary([{ name: "Frag Grenade" }, { name: "Rope" }, { name: "Frag Grenade" }])).toBe("2x Frag Grenade, Rope");
  });
});

describe("completing a purchase of several units", () => {
  beforeEach(() => resetWorld());

  /**
   * A shop that values minor items as minor and tracks loyalty.
   * @param {Object[]} items - Its stock
   * @returns {Object} The shop actor
   */
  function loyalShop(items) {
    return makeShop({ system: { loyaltyEnabled: true, valuation: { minor: "minor" } }, items });
  }

  test("three units of one row move in one transfer and count three times", async () => {
    const calls = stubSystemApi();
    const shop = loyalShop([grenade("gren0001", 5)]);
    const buyer = makeCustomer();

    const bought = await completeShopPurchase({ shopUuid: shop.uuid, buyerActorId: buyer.id, itemIds: "gren0001,gren0001,gren0001" });

    expect(calls.transfers).toEqual([{ name: "Frag Grenade", quantity: 3 }]);
    expect(bought).toHaveLength(3);
    expect(shop.items.get("gren0001").system.quantity).toBe(2);
  });

  test("three units earn the loyalty three separate rows of the same tier earn", async () => {
    stubSystemApi();
    const stacked = loyalShop([grenade("gren0001", 3)]);
    const separate = loyalShop([grenade("gren0001", 1), grenade("gren0002", 1), grenade("gren0003", 1)]);
    const buyer = makeCustomer();

    await completeShopPurchase({ shopUuid: stacked.uuid, buyerActorId: buyer.id, itemIds: "gren0001,gren0001,gren0001" });
    await completeShopPurchase({ shopUuid: separate.uuid, buyerActorId: buyer.id, itemIds: "gren0001,gren0002,gren0003" });

    const loyalty = shop => shop.getFlag("eclipsephase", "characterState")[buyer.id].loyalty.value;
    expect(loyalty(stacked)).toBeGreaterThan(0);
    expect(loyalty(stacked)).toEqual(loyalty(separate));
  });

  test("asking for more than is left buys what is left and says the rest is gone", async () => {
    const calls = stubSystemApi();
    const shop = loyalShop([grenade("gren0001", 2)]);
    const buyer = makeCustomer();

    const bought = await completeShopPurchase({ shopUuid: shop.uuid, buyerActorId: buyer.id, itemIds: "gren0001,gren0001,gren0001" });

    expect(calls.transfers).toEqual([{ name: "Frag Grenade", quantity: 2 }]);
    expect(bought).toHaveLength(2);
    expect(global.__shop.notifications.warn).toEqual(["ep2e.shop.warnings.purchaseItemsGone"]);
  });
});

describe("the notice about drugs stocked before a pack held one form", () => {
  beforeEach(() => resetWorld());

  test("it names each affected shop and drug, for the GMs only", async () => {
    stubSystemApi();
    makeShop({ name: "Qiwu Supply", items: [grin("grin0001", ["injection", "oral"]), grenade("gren0001", 1)] });
    makeShop({ name: "Clean Shop", items: [grin("grin0002", ["oral"])] });
    let rendered = null;
    const realRender = foundry.applications.handlebars.renderTemplate;
    foundry.applications.handlebars.renderTemplate = async (template, data) => { rendered = data; return "card"; };
    let message;
    try {
      message = await noticeDrugsWithoutForm();
    } finally {
      foundry.applications.handlebars.renderTemplate = realRender;
    }

    expect(message.whisper).toEqual([game.users.activeGM.id]);
    expect(rendered.boxDetail).toContain("<b>Qiwu Supply</b>: Grin");
    expect(rendered.boxDetail).not.toContain("Clean Shop");
  });

  test("with no shop affected it posts nothing", async () => {
    stubSystemApi();
    makeShop({ items: [grin("grin0002", ["oral"])] });

    expect(await noticeDrugsWithoutForm()).toBeNull();
    expect(global.__shop.createdMessages).toEqual([]);
  });
});
