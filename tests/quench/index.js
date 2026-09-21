import { completeShopPurchase, getLoyaltyLevel, hasFreeFavorSlot, consumeFavorSlot } from "../../module/shop-logic.js";
import { withTempActor, waitUntil, withoutDiceAnimation, seedDice, restoreDice, uniformForFace, lastMessage } from "./helpers.js";

const SHOP_TYPE = "eclipsephase-shop.shop";

/**
 * A shop stocked with one gear item, valued so a purchase grants loyalty.
 * @param {Function} fn - Called with the shop actor and its stocked item
 * @returns {Promise<*>} Whatever fn returned
 */
async function withStockedShop(fn) {
    return await withTempActor({
      type: SHOP_TYPE,
      name: "Quench Shop",
      system: { valuation: { minor: "minor" }, acceptedRepNetworks: { "i-rep": true }, loyaltyEnabled: true },
      items: [{ name: "Quench Stock", type: "gear", system: { cost: "minor" } }]
    }, actor => fn(actor, actor.items.contents[0]));
}

/**
 * A buyer carrying an active ID, so favor slots and rep have somewhere to live.
 * @param {Function} fn - Called with the character actor
 * @returns {Promise<*>} Whatever fn returned
 */
async function withBuyer(fn) {
  return withTempActor({ type: "character", name: "Quench Buyer" }, async actor => {
    await waitUntil(() => actor.getFlag("eclipsephase", "defaultMorphAdded"));
    const [id] = await actor.createEmbeddedDocuments("Item", [{ name: "Quench ID", type: "id" }]);
    await actor.update({ "system.activeID": id.id });
    return fn(actor);
  });
}

Hooks.on("quenchReady", quench => {
  quench.registerBatch("eclipsephase-shop.purchase", context => {
    const { describe, it, assert } = context;

    describe("completing a purchase", function () {
      it("moves the bought item from the shop to the buyer", async function () {
        await withStockedShop(async (shop, stock) => {
          await withBuyer(async buyer => {
            const bought = await completeShopPurchase({
              shopUuid: shop.uuid,
              buyerActorId: buyer.id,
              itemIds: stock.id,
              network: "i-rep",
              favorTier: "moderate"
            });

            assert.lengthOf(bought, 1);
            assert.isOk(buyer.items.getName("Quench Stock"), "buyer should now hold the item");
            assert.notOk(shop.items.get(stock.id), "shop should no longer hold it");
          });
        });
      });

      it("grants loyalty for the purchase, scaled by the shop's own valuation", async function () {
        await withStockedShop(async (shop, stock) => {
          await withBuyer(async buyer => {
            const before = shop.getFlag("eclipsephase", "characterState")?.[buyer.id]?.loyalty?.value ?? 0;

            await completeShopPurchase({
              shopUuid: shop.uuid,
              buyerActorId: buyer.id,
              itemIds: stock.id,
              network: "i-rep",
              favorTier: "moderate"
            });

            const after = shop.getFlag("eclipsephase", "characterState")?.[buyer.id]?.loyalty?.value ?? 0;
            assert.isAbove(after, before, "a minor-valued purchase should raise loyalty");
            assert.isAtLeast(getLoyaltyLevel(shop, after), 1);
          });
        });
      });

      it("the full click path: a failed favor rescued from the card completes the purchase", async function () {
        this.timeout(20000);
        await withStockedShop(async (shop, stock) => {
          await withBuyer(async buyer => {
            await shop.update({ "system.loyaltyEnabled": true });
            await shop.setFlag("eclipsephase", `characterState.${buyer.id}.loyalty`, { value: 60, updated: Date.now() });
            const idItem = buyer.items.get(buyer.system.activeID);
            await idItem.update({ "system.rep.i-rep.value": 60 });
            // A Rep roll spends Moxie, and the default Flat morph grants none.
            await buyer.update({ "system.pools.moxie.value": 1 });
            const loyaltyBefore = shop.getFlag("eclipsephase", "characterState")[buyer.id].loyalty.value;

            const dataset = {
              name: "i-rep",
              key: "rep",
              rollvalue: 60,
              shopUuid: shop.uuid,
              buyerActorId: buyer.id,
              itemIds: stock.id,
              requiredTier: "moderate",
              sellBonus: 0,
              maxBurn: 15,
              bodyBindings: "",
              redeemLevels: 1
            };

            // 91 fails against 60; swapped it reads 19, which succeeds - so the card offers a
            // rescue that actually changes the outcome. An autofail like 99 never would.
            seedDice([uniformForFace(91, 100)]);
            try {
              await withoutDiceAnimation(() => game.eclipsephase.api.rolls.RollCheck(
                dataset, buyer.system, buyer,
                { skipDialog: true, presetOptions: { rollMode: "public", usePool: "", globalMod: 0, burnMod: 0, favorMod: "0" } },
                false, "shopPurchase"
              ));
            } finally {
              restoreDice();
            }

            const card = lastMessage();
            assert.exists(card, "the roll should have produced a card");
            assert.strictEqual(card.flags.eclipsephase.roll.shop.shopUuid, shop.uuid,
              "the card has to carry the shop block, or no rescue can complete the purchase");
            assert.strictEqual(card.flags.eclipsephase.roll.alternatives.originalResult, 2, "91 against 60 is a plain failure");
            assert.strictEqual(card.flags.eclipsephase.roll.alternatives.usageType, "swapped", "the card must offer a swap to rescue");

            // Exactly what clicking the card's pool button hands the system.
            const click = {
              currentTarget: {
                dataset: { usepool: "pool" },
                closest: selector => (selector === "[data-message-id]" ? { dataset: { messageId: card.id } } : null)
              }
            };
            await game.eclipsephase.api.rolls.usePoolFromChat(click);

            // The hook the rescue fires is async and nothing awaits it. Wait for the LAST write of
            // the purchase - the favor slot - so nothing is still running when the temp actors go.
            await waitUntil(() => !hasFreeFavorSlot(buyer, "i-rep", "moderate"), 10000);

            // 60 sits in level 3 of a 25/25/25/25 bar, so redeeming one level lands on 25 exactly.
            const loyaltyAfter = shop.getFlag("eclipsephase", "characterState")[buyer.id].loyalty.value;
            assert.strictEqual(loyaltyAfter, 25, "an eased favor spends loyalty, it never earns it");
            assert.isBelow(loyaltyAfter, loyaltyBefore);
            assert.strictEqual(buyer.system.pools.moxie.value, 0, "the rescue spends the pool point");
            assert.isOk(buyer.items.getName("Quench Stock"), "the rescued purchase should deliver the goods");
          });
        });
      });

      it("the shop sheet renders without a console error", async function () {
        await withStockedShop(async shop => {
          const errors = [];
          const original = console.error;
          console.error = (...args) => {
            errors.push(args);
            original(...args);
          };
          try {
            await shop.sheet.render(true);
            await shop.sheet.close();
          } finally {
            console.error = original;
          }
          assert.lengthOf(errors, 0);
        });
      });

      it("buys nothing when the item is already gone", async function () {
        await withStockedShop(async shop => {
          await withBuyer(async buyer => {
            const bought = await completeShopPurchase({
              shopUuid: shop.uuid,
              buyerActorId: buyer.id,
              itemIds: "doesnotexist01",
              network: "i-rep",
              favorTier: "moderate"
            });
            assert.lengthOf(bought, 0);
          });
        });
      });

      it("an unknown buyer or shop is refused instead of throwing", async function () {
        await withStockedShop(async (shop, stock) => {
          const bought = await completeShopPurchase({
            shopUuid: shop.uuid,
            buyerActorId: "nosuchactor0001",
            itemIds: stock.id,
            network: "i-rep",
            favorTier: "moderate"
          });
          assert.lengthOf(bought, 0);
          assert.isOk(shop.items.get(stock.id), "stock stays put when the buyer cannot be found");
        });
      });
    });

    describe("favor slots on a real ID", function () {
      it("consumes a major slot once and then reports none free", async function () {
        await withBuyer(async buyer => {
          assert.isTrue(hasFreeFavorSlot(buyer, "i-rep", "major"));

          assert.isTrue(await consumeFavorSlot(buyer, "i-rep", "major"));
          assert.isFalse(hasFreeFavorSlot(buyer, "i-rep", "major"));
          assert.isFalse(await consumeFavorSlot(buyer, "i-rep", "major"));
        });
      });

      it("leaves a different network untouched", async function () {
        await withBuyer(async buyer => {
          await consumeFavorSlot(buyer, "i-rep", "major");
          assert.isTrue(hasFreeFavorSlot(buyer, "g-rep", "major"));
        });
      });
    });
  }, { displayName: "Eclipse Phase: Shop purchases" });

  quench.registerBatch("eclipsephase-shop.sell", context => {
    const { describe, it, assert } = context;

    describe("shop stock and pricing", function () {
      it("a morph in a shop is priced by that shop's own thresholds", async function () {
        await withTempActor({
          type: SHOP_TYPE,
          name: "Quench Morph Shop",
          system: { morphPointOverrides: { moderateMin: 10, majorMin: 20, rareMin: 30 } },
          items: [{ name: "Quench Flat", type: "morph", system: { morphPoints: 8 } }]
        }, shop => {
          const morph = shop.items.getName("Quench Flat");
          morph.prepareData();
          assert.strictEqual(morph.system.cost, "minor", "8 MP is below this shop's moderate threshold");
        });
      });

      it("the same morph on a character keeps the default tier", async function () {
        await withTempActor({ type: "character", name: "Quench Morph Owner" }, async actor => {
          await waitUntil(() => actor.getFlag("eclipsephase", "defaultMorphAdded"));
          const [morph] = await actor.createEmbeddedDocuments("Item", [
            { name: "Quench Flat", type: "morph", system: { morphPoints: 8 } }
          ]);
          morph.prepareData();
          assert.strictEqual(morph.system.cost, "rare");
        });
      });

      it("a shop actor can be created while the system is enabled and is gone again afterwards", async function () {
        let seenId = null;
        await withStockedShop(shop => {
          seenId = shop.id;
          assert.isOk(game.actors.get(seenId));
        });
        assert.notOk(game.actors.get(seenId), "the temporary shop should be cleaned up");
      });
    });
  }, { displayName: "Eclipse Phase: Shop stock and pricing" });
});
