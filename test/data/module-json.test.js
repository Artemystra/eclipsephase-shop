const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));

/**
 * The branch a manifest URL is served from, for the branch-style URL a development branch carries.
 * A release uses the release-scheme URL instead and has no branch.
 * @param {String} url - The manifest URL from module.json
 * @returns {String|null} The branch name, or null when the URL names a release
 */
function manifestBranch(url) {
  return /^https:\/\/github\.com\/Artemystra\/eclipsephase-shop\/raw\/([^/]+)\/module\.json$/.exec(url)?.[1] ?? null;
}

describe("module.json", () => {
  test("declares the id the shop actor type is namespaced under", () => {
    expect(manifest.id).toEqual("eclipsephase-shop");
    expect(manifest.documentTypes).toEqual({ Actor: { shop: {} } });
  });

  test("requires the system version whose drug and munition API it stocks through", () => {
    const system = manifest.relationships.systems.find(entry => entry.id === "eclipsephase");
    expect(system).toBeDefined();
    expect(system.compatibility.minimum).toEqual("2.8.5");
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

  test("the manifest is either the rolling latest-release alias or a branch of this repository", () => {
    expect(manifest.manifest).toMatch(
      /^https:\/\/github\.com\/Artemystra\/eclipsephase-shop\/(releases\/latest\/download\/module\.json|raw\/[^/]+\/module\.json)$/
    );
  });

  test("the download comes from the same source the manifest names", () => {
    const ref = manifestBranch(manifest.manifest);
    const expected = ref
      ? `https://github.com/Artemystra/eclipsephase-shop/archive/${ref}/eclipsephase-shop-${ref}.zip`
      : `https://github.com/Artemystra/eclipsephase-shop/releases/download/v${manifest.version}/eclipsephase-shop.zip`;
    expect(manifest.download).toEqual(expected);
  });

  test("its version matches the one package.json carries", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(manifest.version).toEqual(pkg.version);
  });
});
