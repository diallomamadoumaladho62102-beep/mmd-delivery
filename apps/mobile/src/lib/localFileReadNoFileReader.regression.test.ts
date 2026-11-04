/**
 * Regression: local uploads must not use local-URI network reads
 * that hit RCTFileReaderModule (iOS EXC_BAD_ACCESS under memory pressure).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const files = [
  "uploadMenuItemImage.ts",
  "uploadFile.ts",
  "taxiSafetyRecordingApi.ts",
  "readLocalFileBytes.ts",
  "../screens/restaurant/RestaurantMenuScreen.tsx",
  "../screens/DriverProfileScreen.tsx",
];

for (const rel of files) {
  const raw = fs.readFileSync(path.join(root, rel), "utf8");
  const src = stripComments(raw);
  assert.equal(
    /fetch\s*\(\s*(asset\.uri|fileUri|params\.uri|photoUri|uploadUri)/.test(src),
    false,
    `${rel} must not fetch(localUri)`,
  );
  assert.equal(
    /\.arrayBuffer\s*\(/.test(src),
    false,
    `${rel} must not call arrayBuffer()`,
  );
  assert.equal(
    /response\.blob\s*\(/.test(src),
    false,
    `${rel} must not call response.blob()`,
  );
  assert.equal(
    /\bFileReader\b|\breadAsText\b/.test(src),
    false,
    `${rel} must not reference FileReader/readAsText`,
  );
}

const reader = fs.readFileSync(path.join(root, "readLocalFileBytes.ts"), "utf8");
assert.equal(reader.includes("expo-file-system/legacy"), true);
assert.equal(reader.includes("getInfoAsync"), true);
assert.equal(reader.includes("readAsStringAsync"), true);
assert.equal(reader.includes("readLocalFileBytesPure"), true);

console.log("localFileReadNoFileReader.regression.test.ts — PASS");
