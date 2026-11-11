import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ADB `input text` is unreliable against Android TextInputs with
 * secureTextEntry=true (React Native). Auth screens must keep a visible
 * Show/Hide control so automation can reveal the field before typing.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screensDir = path.resolve(__dirname, "../screens");

function read(rel: string): string {
  return fs.readFileSync(path.join(screensDir, rel), "utf8");
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const authScreens = [
  "ClientAuthScreen.tsx",
  "DriverAuthScreen.tsx",
  "RestaurantAuthScreen.tsx",
] as const;

for (const file of authScreens) {
  test(`${file} exposes show-password toggle for secure fields`, () => {
    const src = read(file);
    assert.match(src, /secureTextEntry=\{!showPassword\}/);
    assert.match(src, /setShowPassword/);
    assert.match(src, /showPassword/);
    assert.match(
      src,
      /showPassword|hidePassword/,
      `${file} must label Show/Hide for password reveal`,
    );
  });
}

test("ClientAuthScreen show control remains outside password hit target padding", () => {
  const src = read("ClientAuthScreen.tsx");
  assert.match(src, /paddingRight:\s*88/);
  assert.match(src, /showPasswordBtn/);
});

console.log("authShowPassword regression: all checks passed");
