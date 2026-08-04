import assert from "node:assert/strict";
import { staffAdminInvitationEmail } from "./transactionalEmailTemplates";

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

console.log("staffAdminInvite tests passed");
