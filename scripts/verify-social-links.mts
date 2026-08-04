/**
 * Verify official social URLs and QR sidecar JSON consistency.
 *
 * Usage: pnpm brand:social-verify
 * Exit 0 when all checks pass.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOCIAL_QR_TARGETS,
  getActiveSocialLinks,
  getSocialLink,
} from "../shared/socialLinks.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

type CheckResult = {
  id: string;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  finalUrl?: string;
};

async function checkUrl(id: string, url: string): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "MMD-SocialLinkVerify/1.0 (+https://www.mmddelivery.com)",
      },
    });
    const status = res.status;
    const ok = status >= 200 && status < 400;
    return {
      id,
      url,
      ok,
      status,
      finalUrl: res.url,
      error: ok ? undefined : `Unexpected status ${status}`,
    };
  } catch (error) {
    return {
      id,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

const results: CheckResult[] = [];

for (const link of getActiveSocialLinks()) {
  results.push(await checkUrl(link.id, link.url));
}

const tiktok = getSocialLink("tiktok");
if (tiktok?.shareUrl) {
  results.push(await checkUrl("tiktok-share", tiktok.shareUrl));
}

const qrDir = resolve(root, "assets/brand/qr");
const publicQrDir = resolve(root, "apps/web/public/brand/qr");
const assetChecks: Array<{ id: string; ok: boolean; error?: string }> = [];

for (const target of SOCIAL_QR_TARGETS) {
  const png = resolve(qrDir, `${target.fileStem}.png`);
  const svg = resolve(qrDir, `${target.fileStem}.svg`);
  const json = resolve(qrDir, `${target.fileStem}.json`);
  const pubPng = resolve(publicQrDir, `${target.fileStem}.png`);

  if (!existsSync(png) || !existsSync(svg) || !existsSync(json)) {
    assetChecks.push({
      id: `qr-files:${target.fileStem}`,
      ok: false,
      error: "Missing png/svg/json in assets/brand/qr",
    });
    continue;
  }
  if (!existsSync(pubPng)) {
    assetChecks.push({
      id: `qr-public:${target.fileStem}`,
      ok: false,
      error: "Missing public PNG",
    });
    continue;
  }

  try {
    const meta = JSON.parse(readFileSync(json, "utf8")) as { url?: string };
    if (meta.url !== target.url) {
      assetChecks.push({
        id: `qr-url:${target.fileStem}`,
        ok: false,
        error: `Sidecar URL mismatch (expected SSOT url)`,
      });
    } else {
      assetChecks.push({ id: `qr-url:${target.fileStem}`, ok: true });
    }
  } catch (error) {
    assetChecks.push({
      id: `qr-json:${target.fileStem}`,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  links: results,
  assets: assetChecks,
  ok:
    results.every((r) => r.ok) && assetChecks.every((a) => a.ok),
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
