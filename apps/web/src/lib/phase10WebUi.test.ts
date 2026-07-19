import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const webRoot = process.cwd();

function read(rel: string) {
  return readFileSync(join(webRoot, rel), "utf8");
}

// Responsive / a11y web chrome
{
  const shell = read("src/components/AdminShell.tsx");
  assert.match(shell, /aria-label="Admin sections"/);
  assert.match(shell, /max-w-6xl/);
  assert.match(shell, /overflow-x-auto/);

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
}

// Layout uses AdminShell for non-hub routes
{
  const layout = read("app/admin/layout.tsx");
  assert.match(layout, /AdminShell/);
  assert.match(layout, /pathname === "\/admin"/);
}

assert.ok(existsSync(join(webRoot, "src/components/AdminShell.tsx")));

console.log("phase10WebUi tests passed");
