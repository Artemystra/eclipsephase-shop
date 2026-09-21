const REP_NETWORKS = ["@-rep", "c-rep", "f-rep", "g-rep", "i-rep", "r-rep", "x-rep"];
const RATE_TIERS = ["minor", "moderate", "major"];
const COST_TIERS = ["minor", "moderate", "major", "rare"];
const FAVOR_TIERS = ["trivial", "minor", "moderate", "major"];
const LOYALTY_SEGMENTS = { red: 25, orange: 25, yellow: 25, green: 25 };
const LOYALTY_BUY_DISCOUNT = { level2: 10, level3: 20, level4: 30 };

/**
 * A number a GM may leave blank to fall back on the system default.
 * @returns {Object} The field definition
 */
function optionalNumber() {
  const { NumberField } = foundry.data.fields;
  return new NumberField({ required: true, nullable: true, initial: null });
}

/**
 * The three rates a shop can override for one cost tier.
 * @returns {Object} The field definition
 */
function rateFields() {
  const { SchemaField } = foundry.data.fields;
  return new SchemaField({
    flatBuyCost: optionalNumber(),
    sellBonus: optionalNumber(),
    sellRepGain: optionalNumber()
  });
}

/**
 * Builds a schema field per entry of a list, so the repetitive per-network and per-tier parts of
 * the schema stay in one place.
 * @param {String[]} keys - The keys to build fields for
 * @param {Function} build - Called per key, returns that key's field
 * @returns {Object} The field definition
 */
function schemaOver(keys, build) {
  const { SchemaField } = foundry.data.fields;
  return new SchemaField(Object.fromEntries(keys.map(key => [key, build(key)])));
}

/**
 * The shop actor's own data. Mirrors what template.json's Actor.shop carried before this class
 * existed, so an existing shop keeps every setting when it starts being validated by this schema.
 */
export default class ShopModel extends foundry.abstract.TypeDataModel {
  /**
   * schemaVersion exists so that cleaning a legacy shop's data against this schema can never
   * produce the data it started from. A type change has to carry its system data as a forced
   * replacement, and the server - which has no data model for a module sub-type - drops a
   * replacement whose value equals what is already stored, after which the client rejects the type
   * change for arriving without one. A key no pre-module shop can have keeps the two apart.
   * @returns {Object} The field definitions
   */
  static defineSchema() {
    const { SchemaField, BooleanField, NumberField, StringField } = foundry.data.fields;

    return {
      schemaVersion: new NumberField({ required: true, nullable: false, integer: true, initial: 1 }),

      acceptedRepNetworks: schemaOver(REP_NETWORKS, () =>
        new BooleanField({ required: true, initial: true })),
      acceptsSales: new BooleanField({ required: true, initial: true }),
      sellLimitMaxItems: new NumberField({ required: true, nullable: false, initial: 0 }),
      sellLimitMaxRep: new NumberField({ required: true, nullable: false, initial: 0 }),

      valuation: schemaOver(COST_TIERS, tier =>
        new StringField({ required: true, initial: tier })),
      difficultyMapping: schemaOver(FAVOR_TIERS, tier =>
        new StringField({ required: true, initial: tier })),

      loyaltyEnabled: new BooleanField({ required: true, initial: true }),
      loyaltyPerTier: schemaOver(COST_TIERS, () => optionalNumber()),
      loyaltyBarMax: new NumberField({ required: true, nullable: false, initial: 100 }),
      loyaltyBarSegments: schemaOver(Object.keys(LOYALTY_SEGMENTS), colour =>
        new NumberField({ required: true, nullable: false, initial: LOYALTY_SEGMENTS[colour] })),
      loyaltyBuyDiscount: schemaOver(Object.keys(LOYALTY_BUY_DISCOUNT), level =>
        new NumberField({ required: true, nullable: false, initial: LOYALTY_BUY_DISCOUNT[level] })),

      generalRateOverrides: schemaOver(RATE_TIERS, () => rateFields()),
      morphPointOverrides: new SchemaField({
        moderateMin: optionalNumber(),
        majorMin: optionalNumber(),
        rareMin: optionalNumber()
      }),
      rateOverrides: schemaOver(REP_NETWORKS, () => schemaOver(RATE_TIERS, () => rateFields()))
    };
  }
}
