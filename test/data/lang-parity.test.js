const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));

/**
 * Every leaf of a language file as [path, value]. Paths are collected while walking rather than
 * re-resolved afterwards, because a key may itself contain a dot (TYPES.Actor."<module>.shop").
 * @param {Object} object - The parsed language file
 * @param {String[]} [prefix] - The path walked so far
 * @returns {Array<[String, *]>} The leaves
 */
function leaves(object, prefix = []) {
  return Object.entries(object).flatMap(([key, value]) => {
    const keyPath = [...prefix, key];
    return value && typeof value === "object" && !Array.isArray(value)
      ? leaves(value, keyPath)
      : [[keyPath.join(" \u203a "), value]];
  });
}

/**
 * Every leaf key of a language file.
 * @param {Object} object - The parsed language file
 * @returns {String[]} The leaf key paths
 */
function leafKeys(object) {
  return leaves(object).map(([keyPath]) => keyPath);
}

const languages = Object.fromEntries(manifest.languages.map(entry => [
  entry.lang,
  JSON.parse(fs.readFileSync(path.join(ROOT, entry.path), "utf8"))
]));
const reference = leafKeys(languages.en).sort();

describe("language parity", () => {
  test.each(Object.keys(languages).filter(lang => lang !== "en"))("%s carries exactly the keys en carries", lang => {
    expect(leafKeys(languages[lang]).sort()).toEqual(reference);
  });

  test.each(Object.keys(languages))("%s leaves no value empty", lang => {
    const empty = leaves(languages[lang])
      .filter(([, value]) => typeof value !== "string" || value.trim() === "")
      .map(([keyPath]) => keyPath);
    expect(empty).toEqual([]);
  });

  test("the shop actor type is labelled under the namespaced id", () => {
    for (const [lang, content] of Object.entries(languages)) {
      expect(content.TYPES?.Actor?.["eclipsephase-shop.shop"]).toBeTruthy();
      expect(typeof content.TYPES.Actor["eclipsephase-shop.shop"]).toBe("string");
      expect(lang).toBeTruthy();
    }
  });

  test("the migration strings the module reports with are present everywhere", () => {
    for (const content of Object.values(languages)) {
      expect(content.ep2e.shop.migration.done).toBeTruthy();
      expect(content.ep2e.shop.migration.failed).toBeTruthy();
      expect(content.ep2e.shop.warnings.systemTooOld).toBeTruthy();
    }
  });
});
