const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * The paths the release workflow puts into the zip, read from the workflow itself so the two
 * cannot drift apart.
 * @returns {String[]} The top-level paths that ship
 */
function shippedPaths() {
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  const line = workflow.split("\n").find(entry => entry.includes("zip -r"));
  return line.trim().split(/\s+/).slice(3).filter(entry => !entry.endsWith(".zip"));
}

/**
 * Every local file reachable from an entry point by static import, following each one in turn.
 * @param {String} entry - Repo-relative path of the entry point
 * @returns {String[]} Repo-relative paths, the entry point included
 */
function importGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const source = fs.readFileSync(path.join(ROOT, current), "utf8");
    for (const match of source.matchAll(/(?:from|import)\s+"(\.[^"]+)"/g)) {
      const resolved = path.normalize(path.join(path.dirname(current), match[1]));
      if (fs.existsSync(path.join(ROOT, resolved))) queue.push(resolved);
    }
  }
  return [...seen];
}

describe("the release package", () => {
  const shipped = shippedPaths();

  test("it ships every file the module imports at runtime", () => {
    const missing = importGraph("module/index.js")
      .filter(file => !shipped.some(dir => file === dir || file.startsWith(dir + path.sep)));
    expect(missing).toEqual([]);
  });

  test("every path it claims to ship exists", () => {
    for (const entry of shipped) expect(fs.existsSync(path.join(ROOT, entry))).toBe(true);
  });
});
