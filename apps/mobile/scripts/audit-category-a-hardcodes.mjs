/**
 * Category A hardcode gate for priority mobile UI chrome files.
 * Fails if literal title=/label=/placeholder=/accessibilityLabel= remain
 * with English/French UI words (excludes status comparisons / API enums).
 *
 * Run: node apps/mobile/scripts/audit-category-a-hardcodes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, "..", "src");

const PRIORITY_FILES = [
  "screens/driver/DriverVehicleScreen.tsx",
  "components/location/MMDLocationPicker.tsx",
  "screens/DriverAuthScreen.tsx",
  "screens/ClientWalletScreen.tsx",
  "screens/DriverWalletScreen.tsx",
  "screens/DriverRevenueScreen.tsx",
  "screens/restaurant/RestaurantWalletScreen.tsx",
  "screens/seller/SellerWalletScreen.tsx",
  "screens/taxi/BusinessWalletScreen.tsx",
  "screens/RestaurantOrderDetailsScreen.tsx",
];

/** UI chrome words in EN/FR (labels, buttons, a11y). */
const UI_WORD_RE =
  /\b(Cancel|Save|Retry|History|Wallet|Loading|Error|Camera|Gallery|Remove|Print|Printing|Refuse|Confirm|Address|City|State|Zip|License|Emergency|Notes|Items|Customer|Passenger|Bicycle|Motorcycle|Gallery|Retake|Commune|Quartier|Landmark|Annuler|Enregistrer|Réessayer|Historique|Portefeuille|Caméra|Galerie|Supprimer|Imprimer|Adresse|Ville|Notes|Client|Vélo|Moto|Voiture)\b/i;

/** Content samples / brand / symbols that are not chrome failures. */
const ALLOW_VALUE = [
  /^MMD(\s|$)/i,
  /^New York$/i,
  /^Matoto$/i,
  /^Lambanyi$/i,
  /^NY$/i,
  /^ABC123$/i,
  /^YYYY-MM-DD$/i,
  /^AAAA-MM-JJ$/i,
  /^Ex:/i,
  /^e\.g\./i,
  /^Station Total/i,
  /^Main St/i,
  /^After Total/i,
  /^1112 /i,
  /^10001$/i,
  /^11226$/i,
  /^123$/i,
  /^2020$/i,
  /^Black$/i,
  /^—$/,
  /^https?:/i,
  /^\$/,
  /^Conakry$/i,
];

const PROP_RE =
  /\b(title|subtitle|label|placeholder|accessibilityLabel|accessibilityHint)\s*=\s*(?:\{)?["'`]([^"'`]{2,160})["'`]/g;

function isAllowed(value) {
  const v = value.trim();
  if (!/[A-Za-zÀ-ÿ]/.test(v)) return true;
  if (ALLOW_VALUE.some((re) => re.test(v))) return true;
  // Pure route / enum-ish tokens
  if (/^[A-Z][A-Za-z0-9_]+$/.test(v) && !/\s/.test(v)) return true;
  return false;
}

function looksLikeStatusComparison(line) {
  return (
    /===\s*["'`]/.test(line) ||
    /!==\s*["'`]/.test(line) ||
    /\.includes\(\s*["'`]/.test(line) ||
    /status\s*===/.test(line) ||
    /case\s+["'`]/.test(line)
  );
}

const findings = [];

for (const rel of PRIORITY_FILES) {
  const full = path.join(srcRoot, rel);
  if (!fs.existsSync(full)) {
    findings.push({ file: rel, kind: "missing", value: "file not found" });
    continue;
  }
  const text = fs.readFileSync(full, "utf8");
  const lines = text.split(/\r?\n/);
  const propRe = new RegExp(PROP_RE.source, "g");
  let m;
  while ((m = propRe.exec(text))) {
    const prop = m[1];
    const value = m[2];
    if (isAllowed(value)) continue;
    if (!UI_WORD_RE.test(value)) continue;
    const before = text.slice(0, m.index);
    const lineNo = before.split(/\r?\n/).length;
    const line = lines[lineNo - 1] ?? "";
    if (looksLikeStatusComparison(line)) continue;
    findings.push({
      file: rel,
      kind: `prop:${prop}`,
      value,
      line: lineNo,
    });
  }
}

if (findings.length) {
  console.error("Category A hardcode audit FAILED:");
  for (const f of findings) {
    console.error(` - ${f.file}:${f.line ?? "?"} [${f.kind}] ${JSON.stringify(f.value)}`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      filesScanned: PRIORITY_FILES.length,
      findingCount: 0,
    },
    null,
    2,
  ),
);
process.exit(0);
