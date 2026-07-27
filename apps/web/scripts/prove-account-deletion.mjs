/**
 * Production throwaway account-deletion proof (self-contained).
 * NEVER prints passwords or service keys.
 *
 * Run via:
 *   npx vercel env run --environment production -- node scripts/prove-account-deletion.mjs
 */
import { createClient } from "@supabase/supabase-js";

const site = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL ||
  "https://www.mmddelivery.com"
)
  .toString()
  .replace(/\/$/, "");
const apiBase = site.startsWith("http") ? site : `https://${site}`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}

if (!url || !serviceKey || !anon) {
  fail("missing supabase env");
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now().toString(36);
const email = `delete.proof.${stamp}@mmddelivery.invalid`;
const password = `Proof-${stamp}-Aa1!`;

const out = {
  ok: false,
  steps: {},
};

async function main() {
  // 1) Create throwaway auth user
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { proof: "account_deletion" },
  });
  if (createErr || !created.user) fail(`createUser: ${createErr?.message}`);
  const userId = created.user.id;
  out.steps.createUser = { ok: true, userIdPrefix: userId.slice(0, 8) };

  // 2) Ensure profile row (client role)
  const { error: upsertErr } = await admin.from("profiles").upsert({
    id: userId,
    role: "client",
    account_status: "active",
    full_name: "Delete Proof",
    is_founder: false,
  });
  if (upsertErr) fail(`profiles upsert: ${upsertErr.message}`);
  out.steps.profile = { ok: true };

  // 3) Sign in as user to get bearer
  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sess, error: signErr } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr || !sess.session?.access_token) {
    fail(`signIn: ${signErr?.message}`);
  }
  out.steps.signIn = { ok: true };

  // 4) Wrong password must 403
  const bad = await fetch(`${apiBase}/api/account/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sess.session.access_token}`,
    },
    body: JSON.stringify({
      password: "wrong-password-xxx",
      confirm_phrase: "DELETE",
      expected_role: "client",
    }),
  });
  const badBody = await bad.json().catch(() => ({}));
  out.steps.wrongPassword = {
    status: bad.status,
    ok: bad.status === 403,
    error: badBody.error ?? null,
  };
  if (bad.status !== 403) fail("wrong password did not return 403");

  // 5) Missing confirm phrase must 400
  const noPhrase = await fetch(`${apiBase}/api/account/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sess.session.access_token}`,
    },
    body: JSON.stringify({
      password,
      confirm_phrase: "NOPE",
      expected_role: "client",
    }),
  });
  out.steps.badPhrase = {
    status: noPhrase.status,
    ok: noPhrase.status === 400,
  };
  if (noPhrase.status !== 400) fail("bad phrase did not return 400");

  // 6) Real delete
  const del = await fetch(`${apiBase}/api/account/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sess.session.access_token}`,
    },
    body: JSON.stringify({
      password,
      confirm_phrase: "DELETE",
      expected_role: "client",
    }),
  });
  const delBody = await del.json().catch(() => ({}));
  out.steps.delete = {
    status: del.status,
    ok: del.status === 200 && delBody.ok === true,
    deleted: delBody.deleted === true,
  };
  if (!(del.status === 200 && delBody.ok === true)) {
    fail(`delete failed: ${del.status} ${delBody.error ?? ""}`);
  }

  // 7) Profile is deleted
  const { data: profile } = await admin
    .from("profiles")
    .select("account_status, deleted_at, full_name, email")
    .eq("id", userId)
    .maybeSingle();
  out.steps.profileAfter = {
    account_status: profile?.account_status ?? null,
    hasDeletedAt: Boolean(profile?.deleted_at),
    anonymizedName: String(profile?.full_name ?? "").startsWith("Deleted User"),
  };
  if (profile?.account_status !== "deleted") fail("profile not deleted");

  // 8) Audit event exists
  const { data: events } = await admin
    .from("account_deletion_events")
    .select("id, role, executed_at")
    .eq("user_id", userId)
    .limit(1);
  out.steps.auditEvent = {
    ok: Array.isArray(events) && events.length > 0,
    role: events?.[0]?.role ?? null,
  };

  // 9) Login blocked
  const { error: loginAfter } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  out.steps.loginAfterDelete = {
    blocked: Boolean(loginAfter),
    message: loginAfter?.message?.slice(0, 120) ?? null,
  };

  // 10) Reactivation without GUC should fail
  const { error: reactivateErr } = await admin
    .from("profiles")
    .update({ account_status: "active" })
    .eq("id", userId);
  out.steps.reactivationBlocked = {
    ok: Boolean(reactivateErr),
    message: reactivateErr?.message?.slice(0, 160) ?? null,
  };

  out.ok =
    out.steps.delete.ok &&
    out.steps.profileAfter.account_status === "deleted" &&
    out.steps.auditEvent.ok &&
    out.steps.loginAfterDelete.blocked;

  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
