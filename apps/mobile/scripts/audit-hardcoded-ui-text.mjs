/**
 * Audit Alert.alert / Safety Audio i18n in mobile src.
 * Run: node apps/mobile/scripts/audit-hardcoded-ui-text.mjs
 * With --strict (default for CI): exit 1 if any literal Alert.alert titles remain
 * or Safety Audio UI is not i18n'd.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "..", "src");
const reportOnly = process.argv.includes("--report-only");
const strict = !reportOnly;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(tsx|ts|jsx|js)$/.test(name) && !name.includes(".test.")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(srcDir);
let literalAlerts = 0;
const findings = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  // A template literal opening with `${` is a dynamic (usually t()-based) title, not a literal.
  const re = /Alert\.alert\(\s*(?:["']|`(?!\$))/g;
  let m;
  while ((m = re.exec(text))) {
    literalAlerts += 1;
    const before = text.slice(0, m.index);
    const line = before.split(/\r?\n/).length;
    const rel = path.relative(path.join(__dirname, ".."), file).replace(/\\/g, "/");
    findings.push({ file: rel, line });
  }
}

console.log("Hardcoded Alert.alert literal titles:", literalAlerts);
if (findings.length) {
  for (const f of findings.slice(0, 40)) {
    console.log(` - ${f.file}:${f.line}`);
  }
  if (findings.length > 40) console.log(` ... +${findings.length - 40} more`);
}

const panel = fs.readFileSync(
  path.join(srcDir, "components/taxi/TaxiSafetyRecordingPanel.tsx"),
  "utf8",
);
const safetyCard = fs.readFileSync(
  path.join(srcDir, "components/tracking/SafetyAudioCard.tsx"),
  "utf8",
);
const panelHard = /Alert\.alert\(\s*(?:["']|`(?!\$))/.test(panel);
const cardUsesT =
  /useTranslation/.test(safetyCard) && /t\("taxi\.tracking\.safety/.test(safetyCard);

console.log("SafetyAudioCard uses i18n:", cardUsesT ? "YES" : "NO");
console.log("TaxiSafetyRecordingPanel literal Alert titles:", panelHard ? "YES" : "NO");

if (strict && (literalAlerts > 0 || !cardUsesT || panelHard)) {
  console.error(
    "STRICT FAIL: hardcoded user Alert.alert literals and/or Safety Audio UI not fully i18n",
  );
  process.exit(1);
}

console.log(
  literalAlerts === 0 && cardUsesT && !panelHard
    ? "Hardcoded UI audit: PASS"
    : "Hardcoded UI audit: REPORT",
);
console.log("audit-hardcoded-ui-text done");
