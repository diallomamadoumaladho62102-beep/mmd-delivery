import assert from "node:assert/strict";
import fs from "node:fs";
import { COOKIES_SECTIONS, PRIVACY_SECTIONS, TERMS_SECTIONS } from "./legalPageCopy";
import { buildCookiesFallbackBlocks } from "./cookiesContent";
import { buildPrivacyFallbackBlocks } from "./privacyContent";
import { buildTermsFallbackBlocks } from "./termsContent";
import {
  ACCOUNT_DELETION_URL,
  buildAccountDeletionFallbackBlocks,
} from "./accountDeletionContent";

function sectionText(sections: { title: string; body_md: string }[]): string {
  return sections.map((s) => `${s.title}\n${s.body_md}`).join("\n");
}

const privacy = sectionText(PRIVACY_SECTIONS);
const terms = sectionText(TERMS_SECTIONS);

assert.match(privacy, /Information we collect/);
assert.match(privacy, /How we use information/);
assert.match(privacy, /How we protect information/);
assert.match(privacy, /SMS and phone communications/);
assert.match(privacy, /Information sharing/);
assert.match(privacy, /delete your account in the MMD Delivery app/);
assert.match(privacy, /legal\/account-deletion/);
assert.match(privacy, /Twilio/);
assert.match(privacy, /Supabase/);
assert.match(privacy, /Stripe/);
assert.match(privacy, /STOP/);
assert.match(privacy, /HELP/);
assert.match(privacy, /support@mmddelivery\.com/);
assert.match(privacy, /legal\/sms/);
assert.match(privacy, /explicit opt-in/);
assert.match(privacy, /Mobile numbers are not shared with third parties/);
assert.doesNotMatch(privacy, /for their own marketing/);

assert.match(terms, /MMD Delivery messaging program/);
assert.match(terms, /Program \/ brand name:\*\* MMD Delivery/);
assert.match(terms, /Message and data rates may apply/);
assert.match(terms, /Frequency varies/);
assert.match(terms, /Reply \*\*STOP\*\*/);
assert.match(terms, /Reply \*\*HELP\*\*/);
assert.match(terms, /Consent is not a condition of purchasing/);
assert.match(terms, /legal\/sms/);
assert.match(terms, /Providing a mobile number, creating an account, or accepting these Terms is not consent/);
assert.match(terms, /support@mmddelivery\.com/);
assert.match(terms, /\+1 \(929\) 492-4563/);

const privacyBlocks = buildPrivacyFallbackBlocks();
const termsBlocks = buildTermsFallbackBlocks();
assert.equal(privacyBlocks[0]?.block_type, "hero");
assert.equal(termsBlocks[0]?.block_type, "hero");
assert.ok(privacyBlocks.some((b) => b.block_type === "rich_text"));
assert.ok(termsBlocks.some((b) => b.block_type === "rich_text"));

const cookies = sectionText(COOKIES_SECTIONS);
assert.match(cookies, /Cookie policy/);
assert.match(cookies, /necessary/i);
assert.doesNotMatch(cookies, /coming soon/i);
assert.equal(buildCookiesFallbackBlocks()[0]?.block_type, "hero");

const deletionBlocks = buildAccountDeletionFallbackBlocks();
assert.equal(ACCOUNT_DELETION_URL, "https://www.mmddelivery.com/legal/account-deletion");
assert.equal(deletionBlocks[0]?.block_type, "hero");
assert.ok(
  deletionBlocks.some((b) =>
    String(b.payload?.title ?? "").includes("Delete in the MMD Delivery app"),
  ),
);

const siteShell = fs.readFileSync(
  new URL("./SiteShell.tsx", import.meta.url),
  "utf8",
);
assert.match(siteShell, /hideComingSoonBanner/);
assert.match(siteShell, /pathname\.startsWith\("\/legal"\)/);
assert.match(siteShell, /pathname === "\/cookies"/);

console.log("legalTwilioPages.test.ts — PASS");
