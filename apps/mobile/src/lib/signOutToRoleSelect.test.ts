import assert from "node:assert/strict";
import {
  driverSignOutLabels,
  restaurantSignOutLabels,
  sellerSignOutLabels,
  signOutToRoleSelect,
} from "./signOutToRoleSelect";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok ${name}`))
    .catch((e) => {
      console.error(`FAIL ${name}`);
      throw e;
    });
}

async function main() {
  await test("signOutToRoleSelect clears role, signs out, resets to RoleSelect", async () => {
    let cleared = 0;
    let signedOut = 0;
    const resets: Array<{ index: number; routes: Array<{ name: string }> }> = [];
    await signOutToRoleSelect(
      {
        reset: (s) => {
          resets.push(s);
        },
      },
      {
        clearSelectedRole: async () => {
          cleared += 1;
        },
        signOut: async () => {
          signedOut += 1;
          return { error: null };
        },
      },
    );
    assert.equal(cleared, 1);
    assert.equal(signedOut, 1);
    assert.deepEqual(resets, [{ index: 0, routes: [{ name: "RoleSelect" }] }]);
  });

  await test("signOutToRoleSelect throws and does not reset when signOut fails", async () => {
    const resets: unknown[] = [];
    await assert.rejects(
      () =>
        signOutToRoleSelect(
          {
            reset: (s) => {
              resets.push(s);
            },
          },
          {
            clearSelectedRole: async () => undefined,
            signOut: async () => ({ error: new Error("network") }),
          },
        ),
      /network/,
    );
    assert.equal(resets.length, 0);
  });

  await test("restaurantSignOutLabels expose Log out copy", () => {
    const labels = restaurantSignOutLabels((_k, fb) => fb);
    assert.match(labels.confirm, /log out/i);
    assert.match(labels.title, /log out/i);
    assert.ok(labels.body.length > 10);
  });

  await test("driverSignOutLabels expose Log out copy", () => {
    const labels = driverSignOutLabels((_k, fb) => fb);
    assert.match(labels.confirm, /log out/i);
    assert.match(labels.title, /log out/i);
    assert.match(labels.body, /driver/i);
  });

  await test("sellerSignOutLabels expose Log out copy", () => {
    const labels = sellerSignOutLabels((_k, fb) => fb);
    assert.match(labels.confirm, /log out/i);
    assert.match(labels.title, /log out/i);
    assert.match(labels.body, /seller/i);
  });

  await test("restaurant logout reset target is RoleSelect only (Back-safe stack)", async () => {
    const resets: Array<{ index: number; routes: Array<{ name: string }> }> = [];
    await signOutToRoleSelect(
      { reset: (s) => resets.push(s) },
      {
        clearSelectedRole: async () => undefined,
        signOut: async () => ({ error: null }),
      },
    );
    assert.equal(resets[0]?.index, 0);
    assert.equal(resets[0]?.routes.length, 1);
    assert.equal(resets[0]?.routes[0]?.name, "RoleSelect");
    assert.ok(!resets[0]?.routes.some((r) => /Restaurant/i.test(r.name)));
  });

  console.log("signOutToRoleSelect tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
