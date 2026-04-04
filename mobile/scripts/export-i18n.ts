// apps/mobile/scripts/export-i18n.ts
import fs from "fs";
import path from "path";

// ⚠️ adapte l'import selon ton export dans resources.ts
// cas 1: export const resources = {...}
import { resources } from "../src/i18n/resources";

type AnyObj = Record<string, any>;

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(filePath: string, obj: AnyObj) {
  const pretty = JSON.stringify(obj, null, 2) + "\n";
  fs.writeFileSync(filePath, pretty, "utf8");
}

function main() {
  const base = path.resolve(process.cwd(), "src/i18n/locales");

  const langs = Object.keys(resources);
  if (!langs.length) {
    throw new Error("resources est vide. Vérifie src/i18n/resources.ts");
  }

  for (const lng of langs) {
    const entry: AnyObj = (resources as AnyObj)[lng];
    const translation: AnyObj | undefined = entry?.translation;

    if (!translation || typeof translation !== "object") {
      console.log(`⚠️ skip ${lng}: pas de .translation`);
      continue;
    }

    const dir = path.join(base, lng);
    ensureDir(dir);

    const out = path.join(dir, "common.json");
    writeJson(out, translation);
    console.log(`✅ wrote ${path.relative(process.cwd(), out)}`);
  }

  console.log("🎉 Export terminé.");
}

main();
