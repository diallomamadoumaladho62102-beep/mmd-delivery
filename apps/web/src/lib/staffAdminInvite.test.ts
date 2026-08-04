import assert from "node:assert/strict";
import {
  renderTransactionalEmailHtml,
  staffAdminInvitationEmail,
} from "./transactionalEmailTemplates";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("staff admin invitation email includes role and invite URL", () => {
  const template = staffAdminInvitationEmail({
    inviteeName: "Fatou",
    invitedBy: "Founder",
    roleLabel: "Operations Admin",
    inviteUrl: "https://example.com/invite",
  });
  assert.match(template.subject, /Operations Admin/);
  assert.equal(template.ctaUrl, "https://example.com/invite");
  assert.match(template.bodyHtml, /Fatou/);
  assert.match(template.bodyHtml, /Operations Admin/);
  assert.equal(template.ctaLabel, "Définir mon mot de passe");
});

test("staff admin invitation email is premium and client-safe", () => {
  const expiresAt = new Date("2026-08-05T12:00:00.000Z");
  const template = staffAdminInvitationEmail({
    inviteeName: "Aïcha Diallo",
    invitedBy: "Founder MMD",
    roleLabel: "Finance Admin",
    inviteUrl: "https://www.mmddelivery.com/auth/reset-password#token",
    expiresAt,
  });
  const html = renderTransactionalEmailHtml(template);

  assert.match(html, /email-logo-transparent-v2\.png/);
  assert.match(html, /MMD Delivery/);
  assert.match(html, /Aïcha Diallo/);
  assert.match(html, /Finance Admin/);
  assert.match(html, /Définir mon mot de passe/);
  assert.match(html, /Sécurité/);
  assert.match(html, /personnel/);
  assert.match(html, /expire/);
  assert.match(html, /2026/);
  assert.match(html, /viewport/);
  assert.doesNotMatch(html, /temporary password|mot de passe temporaire/i);
});

console.log("staffAdminInvite tests passed");
