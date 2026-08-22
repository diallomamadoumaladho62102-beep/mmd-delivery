import type Stripe from "stripe";
import {
  resolveStripePlatformAccountId,
  retrievePlatformStripeAccount,
} from "./stripe";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run() {
  console.log("stripePlatformAccount tests");

  assert(resolveStripePlatformAccountId() === null, "no env → null");

  process.env.STRIPE_PLATFORM_ACCOUNT_ID = "acct_test_platform";
  assert(
    resolveStripePlatformAccountId() === "acct_test_platform",
    "acct env resolved",
  );
  delete process.env.STRIPE_PLATFORM_ACCOUNT_ID;

  let retrieveCalls: string[] = [];
  const mockClient = {
    accounts: {
      retrieve: (accountId?: string) => {
        retrieveCalls.push(accountId ?? "");
        return Promise.resolve({
          id: accountId || "acct_legacy",
        } as Stripe.Account);
      },
    },
  } as unknown as Stripe;

  retrieveCalls = [];
  await retrievePlatformStripeAccount(mockClient, "acct_explicit");
  assert(
    retrieveCalls.length === 1 && retrieveCalls[0] === "acct_explicit",
    "explicit id passed",
  );

  retrieveCalls = [];
  process.env.STRIPE_PLATFORM_ACCOUNT_ID = "acct_from_env";
  await retrievePlatformStripeAccount(mockClient);
  assert(
    retrieveCalls.length === 1 && retrieveCalls[0] === "acct_from_env",
    "env id passed",
  );
  delete process.env.STRIPE_PLATFORM_ACCOUNT_ID;

  retrieveCalls = [];
  await retrievePlatformStripeAccount(mockClient);
  assert(
    retrieveCalls.length === 1 && retrieveCalls[0] === "",
    "legacy no-arg fallback",
  );

  console.log("stripePlatformAccount tests passed");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
