import assert from "node:assert/strict";
import test from "node:test";

import {
  accountCreatedEmail,
  orderConfirmationEmail,
  renderTransactionalEmailHtml,
  renderTransactionalEmailText,
} from "./transactionalEmailTemplates";
import { isTransactionalEmailEnabled } from "./transactionalOutbound";

test("transactional email templates render responsive html", () => {
  const template = orderConfirmationEmail({
    orderId: "11111111-1111-4111-8111-111111111111",
    restaurantName: "Pizza House",
  });

  const html = renderTransactionalEmailHtml(template);
  const text = renderTransactionalEmailText(template);

  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("viewport"));
  assert.ok(html.includes("Pizza House"));
  assert.ok(text.includes(template.headline));
});

test("account created template includes welcome headline", () => {
  const template = accountCreatedEmail({ name: "Maladho" });
  assert.equal(template.headline, "Compte créé");
  assert.ok(renderTransactionalEmailHtml(template).includes("Maladho"));
});

test("transactional email stays disabled without env flag", () => {
  const previous = process.env.TRANSACTIONAL_EMAIL_ENABLED;
  process.env.TRANSACTIONAL_EMAIL_ENABLED = "false";
  try {
    assert.equal(isTransactionalEmailEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.TRANSACTIONAL_EMAIL_ENABLED;
    else process.env.TRANSACTIONAL_EMAIL_ENABLED = previous;
  }
});
