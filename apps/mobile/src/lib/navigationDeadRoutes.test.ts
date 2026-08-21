/**
 * Regression: every navigate/replace string target must be a registered screen.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");

function collectRegistered(): Set<string> {
  const registered = new Set<string>();
  const nav = fs.readFileSync(
    path.join(srcRoot, "navigation", "AppNavigator.tsx"),
    "utf8",
  );
  const tabs = fs.readFileSync(
    path.join(srcRoot, "navigation", "DriverTabs.tsx"),
    "utf8",
  );
  for (const m of nav.matchAll(/name="([A-Za-z0-9]+)"/g)) registered.add(m[1]);
  for (const m of tabs.matchAll(/name="([A-Za-z0-9]+)"/g)) registered.add(m[1]);
  return registered;
}

function collectTargets(): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  function walk(dir: string) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(ent.name)) continue;
      if (ent.name.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(p, "utf8");
      const patterns = [
        /(?:navigate|replace)\(\s*["']([A-Za-z0-9]+)["']/g,
        /routes:\s*\[\s*\{\s*name:\s*["']([A-Za-z0-9]+)["']/g,
      ];
      for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
          const name = m[1];
          if (!targets.has(name)) targets.set(name, []);
          const line = src.slice(0, m.index).split("\n").length;
          targets
            .get(name)!
            .push(`${path.relative(srcRoot, p).replace(/\\/g, "/")}:${line}`);
        }
      }
    }
  }
  walk(srcRoot);
  return targets;
}

const registered = collectRegistered();
const targets = collectTargets();
const dead: string[] = [];
for (const [name, locs] of targets) {
  if (!registered.has(name)) {
    dead.push(`${name} @ ${locs[0]}`);
  }
}

assert.equal(
  dead.length,
  0,
  `Dead navigation targets:\n${dead.join("\n")}`,
);
assert.ok(registered.size >= 90, `expected many screens, got ${registered.size}`);
console.log(
  `navigationDeadRoutes.test.ts OK (registered=${registered.size}, targets=${targets.size})`,
);
