// A Foundry stand-in for this module's own tests. Deliberately smaller than the system's harness:
// it carries only what the shop's logic, data model and hooks actually touch, and it never loads
// anything out of the system repo, so the suite runs on its own in CI.

const notifications = { warn: [], error: [], info: [] };
const createdMessages = [];
const hookHandlers = new Map();
const hookCalls = [];
const settingValues = new Map();
const settingDefinitions = new Map();
const uuidRegistry = new Map();

let idCounter = 0;

/**
 * A stable-enough document id.
 * @returns {String} A 16-character id
 */
function randomID() {
  idCounter += 1;
  return `mockid${String(idCounter).padStart(10, "0")}`;
}

/**
 * A deep copy of plain data.
 * @param {*} value - The value to copy
 * @returns {*} The copy
 */
function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepClone(entry)]));
  }
  return value;
}

/**
 * Reads a dot path off an object.
 * @param {Object} object - The root
 * @param {String} path - The dot path
 * @returns {*} The value, or undefined
 */
function getProperty(object, path) {
  return path.split(".").reduce((node, part) => node?.[part], object);
}

/**
 * Writes a dot path onto an object, creating the intermediate objects.
 * @param {Object} object - The root
 * @param {String} path - The dot path
 * @param {*} value - The value to write
 * @returns {void}
 */
function setProperty(object, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  let node = object;
  for (const part of parts) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[last] = value;
}

/**
 * Merges source into target, recursing into plain objects.
 * @param {Object} target - The object written into
 * @param {Object} source - The object read from
 * @returns {Object} The target
 */
function mergeObject(target, source = {}) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (typeof target[key] !== "object" || target[key] === null) target[key] = {};
      mergeObject(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

class MockCollection extends Map {
  get contents() {
    return [...this.values()];
  }
  getName(name) {
    return this.contents.find(entry => entry.name === name);
  }
  filter(fn) {
    return this.contents.filter(fn);
  }
  find(fn) {
    return this.contents.find(fn);
  }
  some(fn) {
    return this.contents.some(fn);
  }
  map(fn) {
    return this.contents.map(fn);
  }
  [Symbol.iterator]() {
    return this.values();
  }
}

class MockDocument {
  constructor(data = {}) {
    this._source = deepClone(data);
    this.id = data._id ?? randomID();
    this.name = data.name ?? "";
    this.type = data.type ?? "base";
    this.system = deepClone(data.system ?? {});
    this.flags = deepClone(data.flags ?? {});
    this.items = new MockCollection();
    for (const itemData of data.items ?? []) {
      const item = new MockItem(itemData, this);
      this.items.set(item.id, item);
    }
    uuidRegistry.set(this.uuid, this);
  }

  get uuid() {
    return `${this.documentName}.${this.id}`;
  }

  get documentName() {
    return "Actor";
  }

  get isOwner() {
    return true;
  }

  getFlag(scope, key) {
    return getProperty(this.flags, `${scope}.${key}`);
  }

  async setFlag(scope, key, value) {
    setProperty(this.flags, `${scope}.${key}`, value);
    return this;
  }

  async update(changes = {}) {
    for (const [key, value] of Object.entries(changes)) {
      setProperty(this, key, value);
      setProperty(this._source, key, value);
    }
    return this;
  }

  toObject() {
    return deepClone({ ...this._source, type: this.type, system: this.system });
  }

  async delete() {
    global.game.actors.delete(this.id);
    uuidRegistry.delete(this.uuid);
    return this;
  }
}

class MockItem extends MockDocument {
  constructor(data = {}, parent = null) {
    super(data);
    this.parent = parent;
  }
  get documentName() {
    return "Item";
  }
}

class MockActor extends MockDocument {}

class MockChatMessage {
  static async create(data = {}) {
    const message = { ...data, id: randomID() };
    createdMessages.push(message);
    return message;
  }
  static getSpeaker({ actor } = {}) {
    return { actor: actor?.id ?? null, alias: actor?.name ?? "" };
  }
}

/**
 * The initial value of a schema, resolved recursively.
 * @param {Object} schema - A map of field name to field instance
 * @returns {Object} The initial data
 */
function initialFor(schema) {
  const out = {};
  for (const [key, field] of Object.entries(schema ?? {})) {
    out[key] = typeof field?.getInitialValue === "function" ? field.getInitialValue() : undefined;
  }
  return out;
}

/**
 * Source data resolved against a schema the way Foundry cleans a full (non-partial) update: keys
 * the schema does not declare are pruned, keys the source omits fall back on their initial value.
 * @param {Object} schema - A map of field name to field instance
 * @param {Object} source - The data to clean
 * @returns {Object} The cleaned data
 */
function cleanAgainst(schema, source) {
  const out = {};
  for (const [key, field] of Object.entries(schema ?? {})) {
    const value = source?.[key];
    if (field?.fields) out[key] = cleanAgainst(field.fields, value);
    else if (value === undefined) out[key] = typeof field?.getInitialValue === "function" ? field.getInitialValue() : undefined;
    else out[key] = value;
  }
  return out;
}

/**
 * Deep equality, matching foundry.utils.equals closely enough for the module's own comparisons.
 * @param {*} a - One value
 * @param {*} b - The other value
 * @returns {Boolean} Whether the two are equivalent
 */
function equals(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(key => equals(a[key], b[key]));
}

global.Hooks = {
  on(event, fn) {
    if (!hookHandlers.has(event)) hookHandlers.set(event, []);
    hookHandlers.get(event).push(fn);
    return fn;
  },
  once(event, fn) {
    return this.on(event, fn);
  },
  off(event, fn) {
    const handlers = hookHandlers.get(event) ?? [];
    const index = handlers.indexOf(fn);
    if (index >= 0) handlers.splice(index, 1);
  },
  callAll(event, ...args) {
    hookCalls.push({ event, args });
    for (const fn of [...(hookHandlers.get(event) ?? [])]) fn(...args);
    return true;
  },
  call(event, ...args) {
    hookCalls.push({ event, args });
    for (const fn of [...(hookHandlers.get(event) ?? [])]) {
      if (fn(...args) === false) return false;
    }
    return true;
  }
};

global.foundry = {
  utils: {
    deepClone,
    equals,
    mergeObject,
    getProperty,
    setProperty,
    randomID,
    isNewerVersion(a, b) {
      const pa = String(a).split(".").map(Number);
      const pb = String(b).split(".").map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const da = pa[i] ?? 0;
        const db = pb[i] ?? 0;
        if (da !== db) return da > db;
      }
      return false;
    }
  },
  abstract: {
    TypeDataModel: class TypeDataModel {
      constructor(data = {}) {
        Object.assign(this, initialFor(this.constructor.defineSchema()), data);
      }
      static defineSchema() {
        return {};
      }
      static cleanData(source) {
        return cleanAgainst(this.defineSchema(), source);
      }
    }
  },
  data: {
    fields: {
      SchemaField: class SchemaField {
        constructor(fields = {}) { this.fields = fields; }
        getInitialValue() { return initialFor(this.fields); }
      },
      BooleanField: class BooleanField {
        constructor(options = {}) { this.options = options; }
        getInitialValue() { return this.options.initial ?? false; }
      },
      NumberField: class NumberField {
        constructor(options = {}) { this.options = options; }
        getInitialValue() { return this.options.initial === undefined ? null : this.options.initial; }
      },
      StringField: class StringField {
        constructor(options = {}) { this.options = options; }
        getInitialValue() { return this.options.initial ?? ""; }
      }
    }
  },
  applications: {
    instances: new Map(),
    handlebars: {
      loadTemplates: async () => {},
      renderTemplate: async () => ""
    },
    api: {
      HandlebarsApplicationMixin: Base => class extends Base {},
      DialogV2: class DialogV2 {
        static async wait() { return { cancelled: true }; }
      }
    },
    apps: {
      DocumentSheetConfig: {
        registered: [],
        registerSheet(documentClass, scope, sheetClass, options) {
          this.registered.push({ scope, sheetClass, options });
        }
      }
    },
    sheets: {
      ActorSheetV2: class ActorSheetV2 {
        static DEFAULT_OPTIONS = {};
        static PARTS = {};
        constructor(options = {}) { this.options = options; }
        async _prepareContext() { return {}; }
        render() { return this; }
      }
    }
  }
};

global.CONST = {
  TOKEN_DISPLAY_MODES: { HOVER: 30 },
  TOKEN_DISPOSITIONS: { NEUTRAL: 0 }
};

// Only the tables the shop actually reads off the system's config.
global.CONFIG = {
  Actor: {
    dataModels: {},
    documentClass: class { static MANAGED_TYPES = ["character", "npc", "goon"]; }
  },
  eclipsephase: {
    favorTiers: { trivial: "ep2e.favor.trivial", minor: "ep2e.favor.minor", moderate: "ep2e.favor.moderate", major: "ep2e.favor.major" },
    costTypes: { minor: "ep2e.cost.minor", moderate: "ep2e.cost.moderate", major: "ep2e.cost.major", rare: "ep2e.cost.rare" },
    effectiveCostTiers: { free: "ep2e.cost.free", minor: "ep2e.cost.minor", moderate: "ep2e.cost.moderate", major: "ep2e.cost.major", rare: "ep2e.cost.rare" },
    repTypes: { "@-rep": "@-rep", "c-rep": "c-rep", "f-rep": "f-rep", "g-rep": "g-rep", "i-rep": "i-rep", "r-rep": "r-rep", "x-rep": "x-rep" },
    repIcons: { "@-rep": "icons/at.svg", "c-rep": "icons/c.svg", "f-rep": "icons/f.svg", "g-rep": "icons/g.svg", "i-rep": "icons/i.svg", "r-rep": "icons/r.svg", "x-rep": "icons/x.svg" }
  }
};

global.Actor = MockActor;
global.Item = MockItem;
global.ChatMessage = MockChatMessage;
global.fromUuid = async uuid => uuidRegistry.get(uuid) ?? null;
global.ForcedReplacement = class ForcedReplacement {
  constructor(value) { this.value = value; }
};
global._replace = value => new global.ForcedReplacement(value);

global.ui = {
  notifications: {
    warn: message => notifications.warn.push(message),
    error: message => notifications.error.push(message),
    info: message => notifications.info.push(message)
  }
};

global.game = {
  actors: new MockCollection(),
  items: new MockCollection(),
  messages: new MockCollection(),
  modules: new MockCollection(),
  user: { id: "user0000000000001", isGM: true, character: null },
  users: { activeGM: { id: "user0000000000001" }, get: () => null },
  socket: { on: () => {}, emit: () => {} },
  i18n: {
    localize: key => key,
    format: (key, data = {}) => `${key} ${JSON.stringify(data)}`
  },
  settings: {
    settings: settingDefinitions,
    register(namespace, key, definition = {}) {
      settingDefinitions.set(`${namespace}.${key}`, definition);
      if (!settingValues.has(`${namespace}.${key}`)) settingValues.set(`${namespace}.${key}`, definition.default);
    },
    get(namespace, key) {
      return settingValues.get(`${namespace}.${key}`);
    },
    async set(namespace, key, value) {
      settingValues.set(`${namespace}.${key}`, value);
      settingDefinitions.get(`${namespace}.${key}`)?.onChange?.(value);
      return value;
    }
  },
  eclipsephase: {
    version: "2.5",
    api: {
      registry: { registerRollSource: () => true, registerSlot: () => true },
      actors: {},
      ui: {},
      rolls: {},
      chat: {}
    }
  }
};

/**
 * Seeds this module's own entry, which Foundry always provides and the module writes its api onto.
 * @returns {void}
 */
function seedModuleEntry() {
  // Read from the manifest rather than pinned here, so a version bump cannot leave the mock behind.
  const manifest = require(require("path").resolve(__dirname, "..", "..", "module.json"));
  global.game.modules.set("eclipsephase-shop", { id: "eclipsephase-shop", version: manifest.version, active: true });
}

/**
 * Clears everything a test may have written.
 * @returns {void}
 */
function resetMock() {
  notifications.warn.length = 0;
  notifications.error.length = 0;
  notifications.info.length = 0;
  createdMessages.length = 0;
  hookCalls.length = 0;
  hookHandlers.clear();
  settingValues.clear();
  settingDefinitions.clear();
  uuidRegistry.clear();
  global.game.actors.clear();
  global.game.items.clear();
  global.game.messages.clear();
  global.game.user.character = null;
  global.CONFIG.Actor.dataModels = {};
  foundry.applications.apps.DocumentSheetConfig.registered.length = 0;
  seedModuleEntry();
}

seedModuleEntry();

global.__shop = {
  seedModuleEntry,
  MockActor,
  MockItem,
  MockCollection,
  notifications,
  createdMessages,
  hookHandlers,
  hookCalls,
  settingValues,
  resetMock
};
