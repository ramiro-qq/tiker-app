import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const violations = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await scan(path); continue; }
    if (!entry.name.endsWith(".css")) continue;
    const source = (await readFile(path, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, declarations] = match;
      for (const property of declarations.matchAll(/(?:^|;)\s*(outline(?:-style|-width)?|box-shadow)\s*:\s*([^;}]+)/g)) {
        const [, name, raw] = property;
        const value = raw.replace(/\s*!important\s*$/, "").trim();
        if (name.startsWith("outline") && !/^(none|0|0px)$/.test(value)) {
          violations.push(`${path}: visible ${name} in ${selector.trim()}`);
        }
        if (name === "box-shadow" && /:focus(?:-visible|-within)?\b/.test(selector) && value !== "none") {
          violations.push(`${path}: shadow-based focus ring in ${selector.trim()}`);
        }
      }
    }
  }
}
await scan(new URL("../src", import.meta.url).pathname);
if (violations.length) {
  console.error("Focus styles violate AGENTS.md:\n" + violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Focus styles passed: no visible outlines or shadow-based focus rings.");
}
