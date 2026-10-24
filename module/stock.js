// What the shop keeps in stock and how a purchase counts it. An item that carries a quantity is
// one row however often it was stocked, and a buyer picks how many of it they want; every unit
// then counts on its own, exactly as if each had been picked separately.

export const DRUG_FORM_UNSET = "ep2e.shop.warnings.drugFormUnset";

/**
 * The system's public API. Read lazily, since this feature is imported before init builds it.
 * @returns {Object} game.eclipsephase.api
 */
function api() {
  return game.eclipsephase.api;
}

/**
 * Whether an item is stocked as a stack: it carries a quantity.
 * @param {Object} item - An item or its source data
 * @returns {Boolean} True for gear, grenades, ammunition, drugs and programs
 */
export function stocksAsStack(item) {
  return foundry.utils.hasProperty(item?.system ?? {}, "quantity");
}

/**
 * How many units of a stock item a buyer can take: its quantity for a stack, one otherwise.
 * @param {Item} item - The stock item
 * @returns {Number} The units on offer
 */
export function availableUnits(item) {
  if (!stocksAsStack(item)) return 1;
  return Math.max(0, Math.floor(Number(item.system.quantity) || 0));
}

/**
 * The form a drug row is sold in, as the character sheet names it: its one form, or ammunition for
 * a pack that loads into a weapon. Nothing for anything else, nor for a drug whose form is unset.
 * @param {Item} item - The stock item
 * @returns {String|null} The localization key
 */
export function drugFormLabel(item) {
  if (item?.type !== "drug") return null;
  if (api().drugs.isAmmoPack(item.system)) return "ep2e.shop.inventory.ammoForm";
  return api().drugs.drugVector(item.system)?.label ?? null;
}

/**
 * Sets how many units a stock row holds. A row is never emptied this way - it is deleted instead.
 * @param {Item} item - The stock item
 * @param {*} value - What the field holds
 * @returns {Promise<Number>} The quantity now stored
 */
export async function setStockQuantity(item, value) {
  const quantity = Math.max(1, Math.floor(Number(value) || 0));
  await item.update({ "system.quantity": quantity });
  return quantity;
}

/**
 * Puts a dropped item into the shop's stock. A drug is settled to one form first, as on a
 * character; a stack joins the matching row instead of adding another.
 * @param {Actor} shop - The shop
 * @param {Object} data - The incoming item's source data
 * @returns {Promise<Item|null>} The row that grew or was created, or null when the form was not chosen
 */
export async function stockItem(shop, data) {
  if (!(await api().drugs.chooseDrugForm(data))) return null;
  if (stocksAsStack(data)) return api().actors.mergeOrCreateItem(shop, data);
  const [created] = await shop.createEmbeddedDocuments("Item", [data]);
  return created ?? null;
}

/**
 * The stock rows that cannot be sold as they are, with the reason: a drug stocked before a pack
 * held one form still offers several.
 * @param {Actor} shop - The shop
 * @returns {Object} Item id to the localization key of the reason
 */
export function lockedStock(shop) {
  const locked = {};
  for (const item of shop.items) {
    if (item.type === "drug" && api().drugs.needsVectorChoice(item.system)) locked[item.id] = DRUG_FORM_UNSET;
  }
  return locked;
}

/**
 * Records how many units of a stock item the buyer wants, kept between 0 and what is on offer.
 * @param {Map<String, Number>} selection - Item id to units
 * @param {Item} item - The stock item
 * @param {*} value - What the spinner holds
 * @returns {Number} The units now recorded
 */
export function setSelectedCount(selection, item, value) {
  const count = Math.min(Math.max(0, Math.floor(Number(value) || 0)), availableUnits(item));
  if (count > 0) selection.set(item.id, count);
  else selection.delete(item.id);
  return count;
}

/**
 * Puts a single-unit row into the cart or takes it out again.
 * @param {Map<String, Number>} selection - Item id to units
 * @param {Item} item - The stock item
 * @returns {Number} The units now recorded
 */
export function toggleSelected(selection, item) {
  return setSelectedCount(selection, item, selection.has(item.id) ? 0 : 1);
}

/**
 * The selection as one entry per unit, so every price, difficulty and loyalty rule counts each
 * unit the way it counts a separately picked item. Rows gone or locked since are left out.
 * @param {Actor} shop - The shop
 * @param {Map<String, Number>} selection - Item id to units
 * @returns {Item[]} The items, each repeated by its units
 */
export function selectionUnits(shop, selection) {
  const locked = lockedStock(shop);
  const units = [];
  for (const [id, count] of selection) {
    const item = shop.items.get(id);
    if (!item || locked[id]) continue;
    const take = Math.min(count, availableUnits(item));
    for (let i = 0; i < take; i++) units.push(item);
  }
  return units;
}

/**
 * Item ids as a purchase carries them - one per unit - counted back up.
 * @param {String[]} ids - Item ids, repeated per unit
 * @returns {Map<String, Number>} Item id to units, in first-seen order
 */
export function countIds(ids) {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/**
 * What was bought, for a chat line: "3x Frag Grenade, Rope".
 * @param {Item[]} units - The items, repeated per unit
 * @returns {String} The summary
 */
export function unitSummary(units) {
  const counts = new Map();
  for (const item of units) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  return [...counts].map(([name, count]) => (count > 1 ? `${count}x ${name}` : name)).join(", ");
}
