import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const webRoot = process.cwd();

function read(rel: string) {
  return readFileSync(join(webRoot, rel), "utf8");
}

// Responsive / a11y web chrome — Admin Figma Desktop 1280
{
  const shell = read("src/components/AdminShell.tsx");
  assert.match(shell, /admin\.shell\.sectionsLabel/);
  assert.match(shell, /Admin sections/);
  assert.match(shell, /admin-figma/);
  assert.match(shell, /overflow-x-auto/);
  assert.match(shell, /MMD Control/);
  assert.match(shell, /ADMIN_LOGO/);
  const adminUi = read("src/components/admin/adminUi.ts");
  assert.match(adminUi, /mmd-logo-ui/);

  const button = read("src/components/Button.tsx");
  assert.match(button, /min-h-11/);
  assert.match(button, /aria-busy/);
  assert.match(button, /focus-visible/);

  const tw = read("tailwind.config.ts");
  assert.match(tw, /xs:\s*"380px"/);
  assert.match(tw, /\.\/app\/\*\*/);
  assert.match(tw, /accent-strong/);

  const css = read("app/globals.css");
  assert.match(css, /--mmd-tap/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.admin-figma/);
  assert.match(css, /#0033cc/i);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.doesNotMatch(css, /html[\s\S]{0,80}overflow-x:\s*auto/);

  const uploader = read("src/components/ChatImageUploader.tsx");
  assert.match(uploader, /t\("Envoi\.\.\."\)/);
  assert.match(uploader, /t\("Envoyer l'image"\)/);
  assert.match(uploader, /aria-label=\{t\("Choose an image"\)\}/);

  const pay = read("src/components/checkout/PayButton.tsx");
  assert.match(pay, /t\("Payer avec Stripe"\)/);
  assert.match(pay, /t\("Paiement\.\.\."\)/);

  const rootLayout = read("app/layout.tsx");
  assert.match(rootLayout, /viewportFit:\s*"cover"/);
  assert.match(rootLayout, /width:\s*"device-width"/);
}

// Layout uses AdminShell for non-login routes
{
  const layout = read("app/admin/layout.tsx");
  assert.match(layout, /AdminShell/);
  assert.match(layout, /admin\/login/);
}

assert.ok(existsSync(join(webRoot, "src/components/AdminShell.tsx")));
assert.ok(existsSync(join(webRoot, "public/brand/mmd-logo-ui.png")));

console.log("phase10WebUi tests passed");
