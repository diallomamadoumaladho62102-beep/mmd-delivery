import assert from "node:assert/strict";
import {
  OFFICIAL_SOCIAL_LINKS,
  OFFICIAL_WEBSITE_URL,
  SOCIAL_QR_TARGETS,
  formatSocialLinksPlainText,
  getActiveSocialLinks,
  getActiveSocialUrlMap,
  getSocialLink,
} from "./socialLinks";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("website and active networks are configured", () => {
  assert.equal(OFFICIAL_WEBSITE_URL, "https://www.mmddelivery.com");
  const active = getActiveSocialLinks();
  assert.deepEqual(
    active.map((l) => l.id),
    ["website", "tiktok", "instagram", "facebook"],
  );
});

test("tiktok defaults to canonical URL and keeps share alternate", () => {
  const tiktok = getSocialLink("tiktok");
  assert.ok(tiktok);
  assert.equal(tiktok.url, "https://www.tiktok.com/@mmddelivery");
  assert.equal(
    tiktok.shareUrl,
    "https://www.tiktok.com/@mmddelivery?_r=1&_t=ZP-98awmQSESJ5",
  );
  assert.equal(tiktok.username, "@mmddelivery");
});

test("future networks stay disabled placeholders", () => {
  for (const id of ["x", "linkedin", "youtube"] as const) {
    const link = getSocialLink(id);
    assert.ok(link);
    assert.equal(link.enabled, false);
    assert.equal(String(link.url ?? "").trim(), "");
  }
  assert.equal(OFFICIAL_SOCIAL_LINKS.length, 7);
});

test("url map and plain text helpers", () => {
  const map = getActiveSocialUrlMap();
  assert.equal(map.website, OFFICIAL_WEBSITE_URL);
  assert.match(formatSocialLinksPlainText(), /TikTok/);
  assert.match(formatSocialLinksPlainText(), /@mmddelivery/);
});

test("QR targets cover website, both tiktok urls, instagram, facebook", () => {
  assert.deepEqual(
    SOCIAL_QR_TARGETS.map((t) => t.id),
    ["website", "tiktok", "tiktok-share", "instagram", "facebook"],
  );
  for (const target of SOCIAL_QR_TARGETS) {
    assert.ok(target.url.startsWith("https://"));
    assert.ok(target.kits.length > 0);
  }
});

console.log("socialLinks tests passed");
