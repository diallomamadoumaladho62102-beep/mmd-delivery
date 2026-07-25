import assert from "node:assert/strict";
import {
  canCreateConfidential,
  canDeleteTask,
  canMutateTask,
  canViewTask,
  isFounderOrSuperAdmin,
  sanitizeTaskText,
} from "./adminTasksAccess";
import type { AdminSession } from "./adminServer";

function session(
  partial: Partial<AdminSession> & Pick<AdminSession, "userId" | "role">
): AdminSession {
  return {
    accountStatus: "active",
    isFounder: false,
    ...partial,
  };
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const founder = session({ userId: "f1", role: "admin", isFounder: true });
const superAdmin = session({ userId: "a1", role: "admin", isFounder: false });
const finance = session({ userId: "fin1", role: "finance" });
const ops = session({ userId: "ops1", role: "ops" });

test("founder and super admin flags", () => {
  assert.equal(isFounderOrSuperAdmin(founder), true);
  assert.equal(isFounderOrSuperAdmin(superAdmin), true);
  assert.equal(isFounderOrSuperAdmin(finance), false);
});

test("founder can view confidential tasks", () => {
  assert.equal(
    canViewTask(founder, {
      privacy: "confidential",
      created_by: "other",
      assignee_ids: [],
    }),
    true
  );
  assert.equal(
    canViewTask(finance, {
      privacy: "confidential",
      created_by: "fin1",
      assignee_ids: [],
    }),
    false
  );
});

test("assignee can view and mutate non-confidential task", () => {
  const task = {
    privacy: "internal",
    created_by: "a1",
    assignee_ids: ["ops1"],
  };
  assert.equal(canViewTask(ops, task), true);
  assert.equal(canMutateTask(ops, task), true);
  assert.equal(canDeleteTask(ops, task), false);
});

test("creator can delete own non-confidential task", () => {
  assert.equal(
    canDeleteTask(ops, { privacy: "internal", created_by: "ops1" }),
    true
  );
  assert.equal(
    canDeleteTask(finance, { privacy: "internal", created_by: "ops1" }),
    false
  );
});

test("only founder/super admin create confidential", () => {
  assert.equal(canCreateConfidential(founder), true);
  assert.equal(canCreateConfidential(superAdmin), true);
  assert.equal(canCreateConfidential(ops), false);
});

test("sanitize strips tags and control chars", () => {
  assert.equal(sanitizeTaskText("<script>alert(1)</script>Hi"), "alert(1)Hi");
  assert.equal(sanitizeTaskText("ab\u0000c"), "abc");
});

console.log("adminTasksAccess tests passed");
