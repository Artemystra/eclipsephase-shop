const path = require("path");
const { MockActor, resetMock } = global.__shop;
const ShopModel = require(path.resolve(__dirname, "..", "..", "module", "shop-model.js")).default;

// Registered the way the module registers it at init, so a shop built here starts on the real
// schema defaults rather than an empty object.
global.CONFIG.Actor.dataModels["eclipsephase-shop.shop"] = ShopModel;

const REP_SLOTS = ["small1", "small2", "small3", "med1", "med2", "large"];
const REP_NETWORKS = ["@-rep", "c-rep", "f-rep", "g-rep", "i-rep", "r-rep", "x-rep"];

/**
 * An actor registered in the world, so uuid lookups and the migration find it.
 * @param {Object} data - Actor data, e.g. { type, name, system, items }
 * @returns {Object} The actor
 */
function makeActor(data = {}) {
  const actor = new MockActor({ name: "Test Actor", ...data });
  global.game.actors.set(actor.id, actor);
  return actor;
}

/**
 * A shop on this module's own type, starting from the data model's defaults so a test only has to
 * name what it cares about.
 * @param {Object} [data] - system overrides and items
 * @returns {Object} The shop actor
 */
function makeShop(data = {}) {
  const model = global.CONFIG.Actor.dataModels["eclipsephase-shop.shop"];
  const defaults = model ? model.cleanData() : {};
  return makeActor({
    type: "eclipsephase-shop.shop",
    name: data.name ?? "Test Shop",
    system: foundry.utils.mergeObject(defaults, data.system ?? {}),
    items: data.items ?? []
  });
}

/**
 * The rep block an ID item carries, with every favor slot present and unused unless stated.
 * @param {Object} [rep] - Per-network overrides
 * @returns {Object} The rep block
 */
function repWithSlots(rep = {}) {
  const out = {};
  for (const network of REP_NETWORKS) {
    out[network] = { name: network, value: 0 };
    for (const slot of REP_SLOTS) out[network][slot] = false;
    Object.assign(out[network], rep[network] ?? {});
  }
  return out;
}

/**
 * A character carrying an active ID, so favor slots and rep have somewhere to live.
 * @param {Object} [rep] - Per-network overrides for the ID's rep block
 * @returns {Object} The character actor
 */
function makeCustomer(rep = {}) {
  return makeActor({
    type: "character",
    name: "Test Customer",
    system: { activeID: "shopcustomerid1" },
    items: [{ _id: "shopcustomerid1", name: "Legit ID", type: "id", system: { rep: repWithSlots(rep) } }]
  });
}

/**
 * Restores settings, documents, hooks and notifications between tests.
 * @returns {void}
 */
function resetWorld() {
  resetMock();
  global.CONFIG.Actor.dataModels["eclipsephase-shop.shop"] = ShopModel;
}

module.exports = { makeActor, makeShop, makeCustomer, repWithSlots, resetWorld };
