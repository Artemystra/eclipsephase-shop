const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));

describe("module.json", () => {
  test("declares the id the shop actor type is namespaced under", () => {
    expect(manifest.id).toEqual("eclipsephase-shop");
    expect(manifest.documentTypes).toEqual({ Actor: { shop: {} } });
  });

  test("requires the system version that first shipped the extension API", () => {
    const system = manifest.relationships.systems.find(entry => entry.id === "eclipsephase");
    expect(system).toBeDefined();
    expect(system.compatibility.minimum).toEqual("2.5");
  });

  test("names a Foundry generation it has been verified against", () => {
    expect(manifest.compatibility.minimum).toEqual("14");
    expect(manifest.compatibility.verified).toEqual("14");
  });

  test("every declared file actually exists", () => {
    const declared = [
      ...manifest.esmodules,
      ...manifest.styles,
      ...manifest.languages.map(entry => entry.path)
    ];
    for (const file of declared) {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    }
  });

  test("ships all five languages the system ships", () => {
    expect(manifest.languages.map(entry => entry.lang).sort()).toEqual(["cn", "de", "en", "es", "pt-BR"]);
  });

  test("the manifest is the rolling latest-release alias, so an installed copy always finds the newest one", () => {
    expect(manifest.manifest).toEqual("https://github.com/Artemystra/eclipsephase-shop/releases/latest/download/module.json");
  });

  test("the download is pinned to the tag matching the declared version", () => {
    expect(manifest.download).toEqual(`https://github.com/Artemystra/eclipsephase-shop/releases/download/v${manifest.version}/eclipsephase-shop.zip`);
  });

  test("its version matches the one package.json carries", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(manifest.version).toEqual(pkg.version);
  });
});
