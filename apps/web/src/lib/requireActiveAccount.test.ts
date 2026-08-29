import assert from "node:assert/strict";
import { assertProfileActive } from "./requireActiveAccount";

function fakeAdmin(status: string | null, error?: { message: string }) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: error ? null : { account_status: status },
                  error: error ?? null,
                }),
              };
            },
          };
        },
      };
    },
  };
}

async function main() {
  const active = await assertProfileActive(fakeAdmin("active") as never, "u1");
  assert.equal(active.ok, true);

  for (const status of ["suspended", "disabled", "deleted", "banned"]) {
    const blocked = await assertProfileActive(fakeAdmin(status) as never, "u1");
    assert.equal(blocked.ok, false);
    if (blocked.ok === false) {
      assert.equal(blocked.status, 403);
      assert.equal(blocked.code, "ACCOUNT_INACTIVE");
    }
  }

  const missing = await assertProfileActive(
    fakeAdmin(null, { message: "db" }) as never,
    "u1"
  );
  assert.equal(missing.ok, false);
  if (missing.ok === false) assert.equal(missing.status, 500);

  const noProfile = await assertProfileActive(
    {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: null, error: null }),
                };
              },
            };
          },
        };
      },
    } as never,
    "u1"
  );
  assert.equal(noProfile.ok, false);
  if (noProfile.ok === false) assert.equal(noProfile.status, 403);

  console.log("requireActiveAccount.test.ts OK");
}

void main();
