import assert from "node:assert/strict";
import {
  computePaydunyaIpnHash,
  verifyPaydunyaIpnHash,
  paydunyaAdapter,
  cinetpayAdapter,
} from "./paymentProviders";

async function main() {
  const env = process.env as Record<string, string | undefined>;
  const prev = {
    PAYDUNYA_MASTER_KEY: env.PAYDUNYA_MASTER_KEY,
    PAYDUNYA_PRIVATE_KEY: env.PAYDUNYA_PRIVATE_KEY,
    CINETPAY_API_KEY: env.CINETPAY_API_KEY,
    CINETPAY_SITE_ID: env.CINETPAY_SITE_ID,
    CINETPAY_WEBHOOK_SECRET: env.CINETPAY_WEBHOOK_SECRET,
  };

  try {
    env.PAYDUNYA_MASTER_KEY = "master-test-key";
    env.PAYDUNYA_PRIVATE_KEY = "private-test-key";
    const hash = computePaydunyaIpnHash("master-test-key");
    assert.equal(verifyPaydunyaIpnHash(hash, "master-test-key"), true);
    assert.equal(verifyPaydunyaIpnHash("deadbeef", "master-test-key"), false);

    const okWebhook = await paydunyaAdapter.parseWebhook(
      { data: { token: "inv_1", status: "completed", hash } },
      new Headers()
    );
    assert.equal(okWebhook.ok, true);
    if (okWebhook.ok) {
      assert.equal(okWebhook.status, "processing");
    }

    const badWebhook = await paydunyaAdapter.parseWebhook(
      { data: { token: "inv_1", status: "completed", hash: "forged" } },
      new Headers()
    );
    assert.equal(badWebhook.ok, false);

    env.CINETPAY_API_KEY = "ck";
    env.CINETPAY_SITE_ID = "site";
    delete env.CINETPAY_WEBHOOK_SECRET;
    const cinet = await cinetpayAdapter.parseWebhook(
      { data: { transaction_id: "tx1", status: "accepted" } },
      new Headers()
    );
    assert.equal(cinet.ok, true);
    if (cinet.ok) {
      assert.equal(cinet.status, "processing");
    }

    env.CINETPAY_WEBHOOK_SECRET = "cinet-secret";
    const cinetBad = await cinetpayAdapter.parseWebhook(
      { data: { transaction_id: "tx1", status: "accepted" } },
      new Headers()
    );
    assert.equal(cinetBad.ok, false);

    const cinetOk = await cinetpayAdapter.parseWebhook(
      { data: { transaction_id: "tx1", status: "accepted" } },
      new Headers({ "x-webhook-secret": "cinet-secret" })
    );
    assert.equal(cinetOk.ok, true);

    console.log("paymentProviders.webhook.test.ts OK");
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete env[k];
      else env[k] = v;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
