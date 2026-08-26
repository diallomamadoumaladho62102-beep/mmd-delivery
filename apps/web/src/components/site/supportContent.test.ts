import assert from "node:assert/strict";
import {
  buildSupportFallbackBlocks,
  supportBlocksIncludeSmsHelp,
  withSupportSmsHelpBlocks,
} from "./supportContent";

const fallback = buildSupportFallbackBlocks();
assert.equal(supportBlocksIncludeSmsHelp(fallback), true);
assert.equal(withSupportSmsHelpBlocks(fallback), fallback);

const cmsWithoutSms = [
  {
    id: "cms-hero",
    page_id: "cms",
    block_type: "hero",
    sort_order: 10,
    visible: true as const,
    status: "published" as const,
    published_at: new Date().toISOString(),
    scheduled_for: null,
    payload: {
      headline: "Help when you need it",
      benefits: ["FAQ self-serve", "Partner onboarding help"],
    },
  },
];
assert.equal(supportBlocksIncludeSmsHelp(cmsWithoutSms), false);
const merged = withSupportSmsHelpBlocks(cmsWithoutSms);
assert.equal(merged.length, 2);
assert.equal(supportBlocksIncludeSmsHelp(merged), true);
const smsBody = String(merged[1]?.payload.body_md ?? "");
assert.match(smsBody, /Reply \*\*HELP\*\*/);
assert.match(smsBody, /Reply \*\*STOP\*\*/);
assert.match(smsBody, /Répondez \*\*HELP\*\*/);
assert.match(smsBody, /Répondez \*\*STOP\*\*/);
assert.match(smsBody, /legal\/sms/);
assert.match(smsBody, /Message and data rates may apply/);
assert.match(smsBody, /Des frais de messages et de données peuvent s’appliquer/);
assert.match(smsBody, /Consent is not a condition of purchase/);
assert.match(String(fallback.find((b) => b.id === "support-rich")?.payload.body_md ?? ""), /Répondez \*\*STOP\*\*/);

console.log("supportContent.test.ts — PASS");
