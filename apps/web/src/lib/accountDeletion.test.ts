import assert from "node:assert/strict";
import {
  DELETABLE_ROLES,
  executeAccountDeletion,
  isDeletableRole,
} from "./accountDeletion";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok ${name}`))
    .catch((e) => {
      console.error(`FAIL ${name}`);
      throw e;
    });
}

type ProfileRow = {
  id: string;
  role: string;
  account_status: string;
  is_founder: boolean;
  email: string | null;
  full_name: string | null;
  phone: string | null;
};

function makeAdminMock(opts: {
  profile: ProfileRow | null;
  profileError?: string;
  updateProfileError?: string;
  authUpdateError?: string;
  eventInsertError?: string;
}) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  let profile = opts.profile ? { ...opts.profile } : null;

  const from = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      update: (payload: unknown) => {
        calls.push({ table, op: "update", payload });
        if (table === "profiles") {
          if (opts.updateProfileError) {
            return {
              eq: () => ({
                neq: async () => ({ error: { message: opts.updateProfileError } }),
              }),
            };
          }
          if (profile && profile.account_status !== "deleted") {
            Object.assign(profile, payload as object);
          }
          return {
            eq: () => ({
              neq: async () => ({ error: null }),
            }),
          };
        }
        return {
          eq: async () => ({ error: null }),
        };
      },
      delete: () => {
        calls.push({ table, op: "delete" });
        return {
          eq: async () => ({ error: null }),
        };
      },
      insert: (payload: unknown) => {
        calls.push({ table, op: "insert", payload });
        if (table === "account_deletion_events" && opts.eventInsertError) {
          return Promise.resolve({ error: { message: opts.eventInsertError } });
        }
        return Promise.resolve({ error: null });
      },
      maybeSingle: async () => {
        if (opts.profileError) {
          return { data: null, error: { message: opts.profileError } };
        }
        return { data: profile, error: null };
      },
    };
    return chain;
  };

  return {
    calls,
    getProfile: () => profile,
    supabaseAdmin: {
      from,
      auth: {
        admin: {
          updateUserById: async (_id: string, payload: unknown) => {
            calls.push({ table: "auth.users", op: "updateUserById", payload });
            if (opts.authUpdateError) {
              return { error: { message: opts.authUpdateError } };
            }
            return { error: null };
          },
          signOut: async () => {
            calls.push({ table: "auth.users", op: "signOut" });
          },
        },
      },
    } as any,
  };
}

async function main() {
  await test("deletable roles are client/driver/restaurant/seller", () => {
    assert.deepEqual([...DELETABLE_ROLES], [
      "client",
      "driver",
      "restaurant",
      "seller",
    ]);
    assert.equal(isDeletableRole("client"), true);
    assert.equal(isDeletableRole("driver"), true);
    assert.equal(isDeletableRole("restaurant"), true);
    assert.equal(isDeletableRole("seller"), true);
    assert.equal(isDeletableRole("admin"), false);
    assert.equal(isDeletableRole("ops"), false);
    assert.equal(isDeletableRole(null), false);
  });

  await test("blocks founder self-deletion", async () => {
    const mock = makeAdminMock({
      profile: {
        id: "u-founder",
        role: "admin",
        account_status: "active",
        is_founder: true,
        email: "f@example.com",
        full_name: "Founder",
        phone: null,
      },
    });
    const result = await executeAccountDeletion({
      supabaseAdmin: mock.supabaseAdmin,
      userId: "u-founder",
      role: "client",
      requestedBy: "u-founder",
    });
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.match(result.error, /Founder/i);
    }
  });

  await test("blocks already-deleted account", async () => {
    const mock = makeAdminMock({
      profile: {
        id: "u1",
        role: "client",
        account_status: "deleted",
        is_founder: false,
        email: "gone@example.com",
        full_name: "Gone",
        phone: null,
      },
    });
    const result = await executeAccountDeletion({
      supabaseAdmin: mock.supabaseAdmin,
      userId: "u1",
      role: "client",
      requestedBy: "u1",
    });
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.match(result.error, /already deleted/i);
    }
  });

  await test("blocks role mismatch (IDOR / wrong expected role)", async () => {
    const mock = makeAdminMock({
      profile: {
        id: "u-client",
        role: "client",
        account_status: "active",
        is_founder: false,
        email: "c@example.com",
        full_name: "Client",
        phone: "123",
      },
    });
    const result = await executeAccountDeletion({
      supabaseAdmin: mock.supabaseAdmin,
      userId: "u-client",
      role: "driver",
      requestedBy: "u-client",
    });
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.match(result.error, /Role mismatch/i);
    }
  });

  await test("blocks staff role from self-service deletion path", async () => {
    const mock = makeAdminMock({
      profile: {
        id: "u-ops",
        role: "ops",
        account_status: "active",
        is_founder: false,
        email: "ops@example.com",
        full_name: "Ops",
        phone: null,
      },
    });
    const result = await executeAccountDeletion({
      supabaseAdmin: mock.supabaseAdmin,
      userId: "u-ops",
      role: "client",
      requestedBy: "u-ops",
    });
    assert.equal(result.ok, false);
  });

  await test("anonymizes profile, bans auth, writes audit for client", async () => {
    const mock = makeAdminMock({
      profile: {
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        role: "client",
        account_status: "active",
        is_founder: false,
        email: "client@example.com",
        full_name: "Alice Client",
        phone: "+15551212",
      },
    });
    const result = await executeAccountDeletion({
      supabaseAdmin: mock.supabaseAdmin,
      userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      role: "client",
      requestedBy: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ipAddress: "1.2.3.4",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.deletedEmail, /^deleted\./);
      assert.match(result.deletedEmail, /@deleted\.mmddelivery\.invalid$/);
    }
    const profile = mock.getProfile();
    assert.equal(profile?.account_status, "deleted");
    assert.equal(profile?.phone, null);
    assert.match(String(profile?.full_name), /^Deleted User/);

    const ops = mock.calls.map((c) => `${c.table}:${c.op}`);
    assert.ok(ops.includes("auth.users:updateUserById"));
    assert.ok(ops.includes("account_deletion_events:insert"));
    assert.ok(ops.includes("admin_audit_logs:insert"));
    assert.ok(ops.includes("user_push_tokens:delete"));
    assert.ok(ops.includes("push_tokens:delete") || ops.includes("client_addresses:delete"));
    assert.ok(ops.includes("sellers:update"));
    assert.ok(ops.includes("taxi_business_members:update"));

    const authUpdate = mock.calls.find(
      (c) => c.table === "auth.users" && c.op === "updateUserById"
    );
    const payload = authUpdate?.payload as {
      ban_duration?: string;
      app_metadata?: { account_status?: string };
    };
    assert.ok(payload?.ban_duration);
    assert.equal(payload?.app_metadata?.account_status, "deleted");
  });

  await test("driver deletion keeps stripe reconciliation path (no wipe of financial tables)", async () => {
    const mock = makeAdminMock({
      profile: {
        id: "driver-1",
        role: "driver",
        account_status: "active",
        is_founder: false,
        email: "d@example.com",
        full_name: "Driver",
        phone: "1",
      },
    });
    const result = await executeAccountDeletion({
      supabaseAdmin: mock.supabaseAdmin,
      userId: "driver-1",
      role: "driver",
      requestedBy: "driver-1",
    });
    assert.equal(result.ok, true);
    const deletedTables = mock.calls
      .filter((c) => c.op === "delete")
      .map((c) => c.table);
    assert.ok(!deletedTables.includes("orders"));
    assert.ok(!deletedTables.includes("taxi_rides"));
    assert.ok(!deletedTables.includes("payments"));
    assert.ok(!deletedTables.includes("payouts"));
  });

  await test("seller-role deletion anonymizes marketplace shop PII", async () => {
    const mock = makeAdminMock({
      profile: {
        id: "seller-1",
        role: "seller",
        account_status: "active",
        is_founder: false,
        email: "s@example.com",
        full_name: "Shop Owner",
        phone: "1",
      },
    });
    const result = await executeAccountDeletion({
      supabaseAdmin: mock.supabaseAdmin,
      userId: "seller-1",
      role: "seller",
      requestedBy: "seller-1",
    });
    assert.equal(result.ok, true);
    const sellerUpdate = mock.calls.find(
      (c) => c.table === "sellers" && c.op === "update"
    );
    const payload = sellerUpdate?.payload as {
      business_name?: string;
      phone?: string;
      status?: string;
      is_accepting_orders?: boolean;
    };
    assert.match(String(payload?.business_name), /^Deleted Seller/);
    assert.equal(payload?.phone, "deleted");
    assert.equal(payload?.status, "suspended");
    assert.equal(payload?.is_accepting_orders, false);
  });

  console.log("accountDeletion tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
