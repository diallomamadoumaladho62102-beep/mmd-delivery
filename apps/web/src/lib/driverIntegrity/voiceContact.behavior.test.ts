import assert from "node:assert/strict";
import test from "node:test";
import { startMaskedAdminDriverCall } from "./voiceContact";
import { sessionContainsPrivatePhone } from "../publicMaskedCallSession";
import { contactIsActive } from "./engineGate";

type SessionRow = Record<string, unknown>;

function createVoiceDb(phones: Record<string, string | null>) {
  const sessions: SessionRow[] = [];
  const supabase = {
    from(table: string) {
      if (table === "profiles") {
        let userId = "";
        return {
          select() {
            return this;
          },
          eq(_col: string, val: string) {
            userId = val;
            return this;
          },
          maybeSingle: async () => ({
            data: { phone: phones[userId] ?? null },
            error: null,
          }),
        };
      }
      if (table === "call_sessions") {
        const filters: Record<string, unknown> = {};
        let insertRow: SessionRow | null = null;
        const api = {
          select() {
            return api;
          },
          eq(col: string, val: unknown) {
            filters[col] = val;
            return api;
          },
          gt(col: string, val: unknown) {
            filters[`gt_${col}`] = val;
            return api;
          },
          order() {
            return api;
          },
          limit() {
            return api;
          },
          insert(row: SessionRow) {
            insertRow = { ...row };
            return api;
          },
          maybeSingle: async () => {
            if (insertRow) {
              const row = {
                id: `sess-${sessions.length + 1}`,
                ...insertRow,
              };
              sessions.push(row);
              return { data: row, error: null };
            }
            const now = Date.now();
            const hit = sessions.find((session) => {
              if (session.caller_user_id !== filters.caller_user_id) return false;
              if (session.target_user_id !== filters.target_user_id) return false;
              if (session.status !== filters.status) return false;
              if (filters.order_id && session.order_id !== filters.order_id) {
                return false;
              }
              const expires = Date.parse(String(session.expires_at ?? ""));
              if (filters.gt_expires_at && !(expires > now)) return false;
              return true;
            });
            return { data: hit ?? null, error: null };
          },
        };
        return api;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { supabase, sessions };
}

test("ready_to_dial creates a session and never leaks phones", async () => {
  const { supabase, sessions } = createVoiceDb({
    admin: "+15551111111",
    driver: "+15552222222",
  });
  const first = await startMaskedAdminDriverCall({
    supabase: supabase as never,
    adminUserId: "admin",
    driverId: "driver",
    entityType: "order",
    entityId: "order-1",
  });
  assert.equal(first.ok, true);
  assert.equal(first.result, "ready_to_dial");
  assert.ok(first.callSessionId);
  assert.ok(first.proxyNumber);
  assert.equal(sessionContainsPrivatePhone(first), false);
  assert.doesNotMatch(JSON.stringify(first), /\+15552222222/);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].target_phone, "+15552222222");
});

test("double click reuses the active session", async () => {
  const { supabase } = createVoiceDb({
    admin: "+15551111111",
    driver: "+15552222222",
  });
  const input = {
    supabase: supabase as never,
    adminUserId: "admin",
    driverId: "driver",
    entityType: "order" as const,
    entityId: "order-1",
  };
  const first = await startMaskedAdminDriverCall(input);
  const second = await startMaskedAdminDriverCall(input);
  assert.equal(first.result, "ready_to_dial");
  assert.equal(second.result, "duplicate");
  assert.equal(second.callSessionId, first.callSessionId);
  assert.equal(second.proxyNumber, first.proxyNumber);
  assert.equal(sessionContainsPrivatePhone(second), false);
});

test("missing admin phone fails closed without a session", async () => {
  const { supabase, sessions } = createVoiceDb({
    admin: null,
    driver: "+15552222222",
  });
  const result = await startMaskedAdminDriverCall({
    supabase: supabase as never,
    adminUserId: "admin",
    driverId: "driver",
    entityType: "order",
    entityId: "order-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.result, "failed");
  assert.equal(result.error, "admin_phone_unavailable");
  assert.equal(result.callSessionId, null);
  assert.equal(sessions.length, 0);
});

test("missing driver phone fails closed without a session", async () => {
  const { supabase, sessions } = createVoiceDb({
    admin: "+15551111111",
    driver: null,
  });
  const result = await startMaskedAdminDriverCall({
    supabase: supabase as never,
    adminUserId: "admin",
    driverId: "driver",
    entityType: "order",
    entityId: "order-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.result, "failed");
  assert.equal(result.error, "driver_phone_unavailable");
  assert.equal(sessions.length, 0);
});

test("unauthorized contact stays off when Driver Integrity contact flag is false", () => {
  assert.equal(contactIsActive({ contactEnabled: false }), false);
});
