import type Stripe from "stripe";
import {
  resolveStripePlatformAccountId,
  retrievePlatformStripeAccount,
  retrieveConnectBalance,
  stripeConnectRequestOptions,
  stripeWebhookPayload,
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

  assert(
    stripeWebhookPayload(Buffer.from("{\"id\":\"evt_test\"}")) === "{\"id\":\"evt_test\"}",
    "webhook payload utf8",
  );

  assert(
    stripeConnectRequestOptions("acct_test_1").stripeAccount === "acct_test_1",
    "connect request options",
  );

  let balanceAccount = "";
  const balanceClient = {
    balance: {
      retrieve: (_params: unknown, opts?: { stripeAccount?: string }) => {
        balanceAccount = String(opts?.stripeAccount ?? "");
        return Promise.resolve({ available: [], pending: [] });
      },
    },
  } as unknown as Stripe;
  await retrieveConnectBalance("acct_bal_test", balanceClient);
  assert(balanceAccount === "acct_bal_test", "connect balance uses request options");

  console.log("stripePlatformAccount tests passed");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
