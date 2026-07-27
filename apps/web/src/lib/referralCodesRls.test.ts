import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

const migrationPath = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260929120000_account_deletion_and_referral_rls.sql"
);

const sql = fs.readFileSync(migrationPath, "utf8");

const requiredSnippets = [
  "account_deletion_events",
  "account_status in ('active', 'suspended', 'disabled', 'deleted')",
  "alter table public.referral_codes enable row level security",
  "referral_codes_select_own",
  "referral_codes_insert_own",
  "drop policy if exists referral_codes_update_own",
  "drop policy if exists referral_codes_delete_own",
  "owner_user_id = auth.uid()",
  "public.is_staff_user()",
  "mmd.allow_account_restore",
  "deleted accounts cannot be restored",
  "sync_referral_codes_owner_user",
];

for (const snippet of requiredSnippets) {
  assert(sql.includes(snippet), `migration missing: ${snippet}`);
}

assert(
  !/create policy referral_codes_update/i.test(sql),
  "must not recreate client update policy on referral_codes"
);
assert(
  !/create policy referral_codes_delete/i.test(sql),
  "must not recreate client delete policy on referral_codes"
);
assert(
  !/for all\s+to authenticated/i.test(sql),
  "must not grant blanket authenticated access"
);
assert(
  !/to anon/i.test(sql),
  "must not grant anon policies on referral_codes / deletion events"
);

console.log("referralCodesRls + account deletion migration tests passed");
