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

const SESSION_ID =
  "cs_live_b1Dc0KtrNoWuRGUjVRW5RWOX0cFGGjOnJi2Qfp8lDzRODxjFDYiu4BvMxZ";

const res = await fetch(`https://api.stripe.com/v1/payment_pages/${SESSION_ID}`, {
  headers: { Authorization: `Bearer ${pk}`, Accept: "application/json" },
});
const json = await res.json();

function summarize(value, depth = 0) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((v) => summarize(v, depth + 1));
  }
  if (depth > 3) return `{keys:${Object.keys(value).length}}`;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/secret|api_key|client_secret|rqdata|site_key/i.test(k)) {
      out[k] = v ? "present" : null;
      continue;
    }
    if (typeof v === "string" && /^(cs_|pi_|ch_|cus_|acct_|pm_)/.test(v)) {
      out[k] = `${v.slice(0, 10)}…${v.slice(-4)}`;
      continue;
    }
    out[k] = summarize(v, depth + 1);
  }
  return out;
}

const focus = {
  http: res.status,
  payment_intent: summarize(json.payment_intent),
  setup_intent: summarize(json.setup_intent),
  payment_method_specs: summarize(json.payment_method_specs),
  payment_method_options: summarize(json.payment_method_options),
  use_payment_methods: json.use_payment_methods,
  has_async_attached_payment_method: json.has_async_attached_payment_method,
  managed_payments: summarize(json.managed_payments),
  lpm_settings: summarize(json.lpm_settings),
  feature_flags_agent: json.feature_flags?.ocs_payment_prompt_for_agents ?? null,
  account_settings: summarize(json.account_settings),
  developer_tool_context: summarize(json.developer_tool_context),
  experiment_data_keys: json.experiment_data
    ? Object.keys(json.experiment_data).slice(0, 20)
    : null,
  custom_text: json.custom_text ?? null,
  ui_mode: json.ui_mode,
  mode: json.mode,
  status: json.status,
  payment_status: json.payment_status,
  state: json.state,
};

console.log(JSON.stringify(focus, null, 2));
