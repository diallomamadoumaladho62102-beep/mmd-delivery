#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const home = process.env.USERPROFILE || process.env.HOME || "";
const configPath = [
  join(home, ".config", "stripe", "config.toml"),
  join(home, "AppData", "Roaming", "stripe", "config.toml"),
].find((p) => existsSync(p));
const raw = readFileSync(configPath, "utf8");
const pk =
  (raw.split(/\r?\n/).find((l) => /live_mode_pub_key/.test(l)) || "").match(
    /['"]([^'"]+)['"]/,
  )?.[1] || "";

const id =
  process.argv[2] ||
  "cs_live_b1T28pcPYWMg2FCKMh6uDPW2m8twYEGbnNAIlrZ5X3spBDEdU41HR3wle3";

const res = await fetch(`https://api.stripe.com/v1/payment_pages/${id}`, {
  headers: { Authorization: `Bearer ${pk}`, Accept: "application/json" },
});
const json = await res.json();

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k] ?? null;
  return out;
}

const account = json.account_settings || {};
const blob = json.blob || {};

console.log(
  JSON.stringify(
    {
      http: res.status,
      core: pick(json, [
        "id",
        "status",
        "payment_status",
        "livemode",
        "currency",
        "mode",
        "amount_total",
        "amount_subtotal",
        "total_details",
        "expires_at",
        "success_url",
        "cancel_url",
        "payment_method_types",
        "automatic_payment_method_types",
        "client_reference_id",
        "enforcement_mode",
        "eid",
        "config_id",
      ]),
      account_settings_keys: Object.keys(account),
      account_settings_sample: pick(account, [
        "account_id",
        "business_name",
        "country",
        "default_currency",
        "display_name",
        "statement_descriptor",
        "support_email",
        "support_phone",
        "support_url",
        "charges_enabled",
        "payouts_enabled",
        "details_submitted",
        "capabilities",
      ]),
      enabled_third_party_wallets: json.enabled_third_party_wallets,
      card_brands: json.card_brands,
      feature_flags_sample: json.feature_flags
        ? Object.fromEntries(Object.entries(json.feature_flags).slice(0, 20))
        : null,
      line_items:
        json.line_items ||
        json.display_items ||
        blob.line_items ||
        blob.display_items ||
        null,
      blob_keys: Object.keys(blob).slice(0, 40),
      has_error_in_blob: Boolean(blob.error || blob.errors),
      blob_error: blob.error || blob.errors || null,
      total: json.total || blob.total || null,
      all_keys: Object.keys(json),
    },
    null,
    2,
  ),
);
