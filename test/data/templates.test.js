const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const entryPoint = fs.readFileSync(path.join(ROOT, "module", "index.js"), "utf8");

/**
 * Every template path the module hands to registerSlot. Slots render as Handlebars partials, which
 * is synchronous, so each one has to be preloaded or it silently renders nothing.
 * @returns {String[]} The template paths
 */
function slotTemplates() {
  return [...entryPoint.matchAll(/registerSlot\([^)]*?template:\s*"([^"]+)"/gs)].map(match => match[1]);
}

/**
 * The paths listed in the module's own preload list.
 * @returns {String[]} The template paths
 */
function preloadedTemplates() {
  const block = entryPoint.match(/const SHOP_TEMPLATES = \[(.*?)\];/s);
  return block ? [...block[1].matchAll(/"([^"]+)"/g)].map(match => match[1]) : [];
}

describe("templates", () => {
  test("every template the module registers as a slot is preloaded", () => {
    const preloaded = preloadedTemplates();
    const slots = slotTemplates();
    expect(slots.length).toBeGreaterThan(0);
    for (const template of slots) {
      expect(preloaded).toContain(template);
    }
  });

  test("every preloaded template exists on disk", () => {
    for (const template of preloadedTemplates()) {
      const relative = template.replace(/^modules\/eclipsephase-shop\//, "");
      expect(fs.existsSync(path.join(ROOT, relative))).toBe(true);
    }
  });

  test("every template path the module references points into the module or the system", () => {
    const referenced = [...entryPoint.matchAll(/"(modules\/[^"]+|systems\/[^"]+)"/g)].map(match => match[1]);
    for (const reference of referenced) {
      if (!reference.startsWith("modules/")) continue;
      expect(reference.startsWith("modules/eclipsephase-shop/")).toBe(true);
    }
  });
});
