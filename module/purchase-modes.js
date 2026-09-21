const purchaseModes = [];

/**
 * Reports a rejected registration without throwing, so one broken caller cannot stop the shop
 * from loading.
 * @param {String} what - The registration that was rejected
 * @param {String} reason - Why it was rejected
 * @returns {Boolean} Always false, so callers can return it directly
 */
function reject(what, reason) {
  console.error(`Eclipse Phase Shops | ${what} was not registered: ${reason}`);
  return false;
}

/**
 * Registers a way of paying for a shop's goods. "Cash in Favor" and "Sell" belong to the shop
 * itself; "Buy" is registered the same way, so a house rule can add or replace a payment route
 * without the sheet growing another branch.
 * @param {Object} definition - Needs id and label, may hold available(context), execute(context),
 *                              footerButton and order
 * @returns {Boolean} Whether the mode was registered
 */
export function registerPurchaseMode(definition = {}) {
  if (!definition.id || !definition.label) return reject("A purchase mode", "it needs both an id and a label");
  if (purchaseModes.some(mode => mode.id === definition.id)) {
    return reject(`Purchase mode "${definition.id}"`, "that id is already taken");
  }
  for (const key of ["available", "execute"]) {
    if (definition[key] !== undefined && typeof definition[key] !== "function") {
      return reject(`Purchase mode "${definition.id}"`, `${key} must be a function`);
    }
  }
  purchaseModes.push({ order: 0, ...definition });
  return true;
}

/**
 * Every registered mode, lowest order first and registration order within the same order.
 * @returns {Object[]} The mode definitions
 */
export function purchaseModeList() {
  return [...purchaseModes].sort((a, b) => a.order - b.order);
}

/**
 * The registered mode with this id.
 * @param {String} id - The mode id
 * @returns {Object|undefined} The definition, or undefined when nothing is registered
 */
export function getPurchaseMode(id) {
  return purchaseModes.find(mode => mode.id === id);
}

/**
 * The modes that apply to the shop state described by the context, in footer-button order. A mode
 * without an available() check always applies.
 * @param {Object} context - What the sheet knows about the current shop, character and selection
 * @returns {Object[]} The applicable mode definitions
 */
export function applicablePurchaseModes(context = {}) {
  return purchaseModeList().filter(mode => (mode.available ? mode.available(context) === true : true));
}

/**
 * Whether one mode applies right now.
 * @param {String} id - The mode id
 * @param {Object} context - What the sheet knows about the current shop, character and selection
 * @returns {Boolean} True while that mode is offered
 */
export function isPurchaseModeAvailable(id, context = {}) {
  const mode = getPurchaseMode(id);
  if (!mode) return false;
  return mode.available ? mode.available(context) === true : true;
}

/**
 * Drops every registration. Only used by tests, which need a clean registry per case.
 * @returns {void}
 */
export function resetPurchaseModes() {
  purchaseModes.length = 0;
}
