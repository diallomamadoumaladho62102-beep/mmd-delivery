#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const home = process.env.USERPROFILE || process.env.HOME || "";
const configPath = [
  join(home, ".config", "stripe", "config.toml"),
  join(home, "AppData", "Roaming", "stripe", "config.toml"),
].find((p) => existsSync(p));
const pk =
  (readFileSync(configPath, "utf8")
    .split(/\r?\n/)
    .find((l) => /live_mode_pub_key/.test(l)) || "").match(/['"]([^'"]+)['"]/)?.[1] ||
  "";

const id =
  process.argv[2] ||
  "cs_live_b1T28pcPYWMg2FCKMh6uDPW2m8twYEGbnNAIlrZ5X3spBDEdU41HR3wle3";

const res = await fetch(`https://api.stripe.com/v1/payment_pages/${id}`, {
  headers: { Authorization: `Bearer ${pk}`, Accept: "application/json" },
});
const json = await res.json();

console.log(
  JSON.stringify(
    {
      session_id: json.session_id,
      stripe_hosted_url: json.stripe_hosted_url,
      state: json.state,
      total_summary: json.total_summary,
      line_item_group: json.line_item_group,
      payment_method_specs: json.payment_method_specs,
      ordered_payment_method_types: json.ordered_payment_method_types,
      permissions: json.permissions,
      policies: json.policies,
      site_key_present: Boolean(json.site_key),
      is_sandbox_merchant: json.is_sandbox_merchant,
      is_unclaimed_anonymous_sandbox: json.is_unclaimed_anonymous_sandbox,
      use_payment_methods: json.use_payment_methods,
      ui_mode: json.ui_mode,
      statement_descriptor: json.account_settings?.statement_descriptor,
      display_name: json.account_settings?.display_name,
      business_url: json.account_settings?.business_url,
      init_checksum: json.init_checksum ? "present" : null,
    },
    null,
    2,
  ),
);
