import assert from "node:assert/strict";
import { resolveAuthorizedChatPushTarget } from "./chatPushTarget";

function fakeAdmin(allowedIds: string[]) {
  return {
    rpc(_name: string, args: { p_user_id: string }) {
      return Promise.resolve({
        data: allowedIds.includes(String(args.p_user_id)),
        error: null,
      });
    },
  };
}

async function main() {
  const sender = "11111111-1111-1111-1111-111111111111";
  const peer = "22222222-2222-2222-2222-222222222222";
  const stranger = "33333333-3333-3333-3333-333333333333";
  const orderId = "44444444-4444-4444-4444-444444444444";

  const ok = await resolveAuthorizedChatPushTarget({
    supabaseAdmin: fakeAdmin([sender, peer]) as never,
    orderId,
    senderUserId: sender,
    targetUserId: peer,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.targetUserId, peer);

  const skipped = await resolveAuthorizedChatPushTarget({
    supabaseAdmin: fakeAdmin([sender]) as never,
    orderId,
    senderUserId: sender,
    targetUserId: "",
  });
  assert.equal(skipped.ok, true);
  if (skipped.ok) assert.equal(skipped.targetUserId, null);

  const strangerDenied = await resolveAuthorizedChatPushTarget({
    supabaseAdmin: fakeAdmin([sender]) as never,
    orderId,
    senderUserId: sender,
    targetUserId: stranger,
  });
  assert.equal(strangerDenied.ok, false);
  if (strangerDenied.ok === false) assert.equal(strangerDenied.error, "invalid_target");

  const outsider = await resolveAuthorizedChatPushTarget({
    supabaseAdmin: fakeAdmin([peer]) as never,
    orderId,
    senderUserId: sender,
    targetUserId: peer,
  });
  assert.equal(outsider.ok, false);
  if (outsider.ok === false) assert.equal(outsider.error, "forbidden");

  console.log("chatPushTarget.test.ts OK");
}

void main();
