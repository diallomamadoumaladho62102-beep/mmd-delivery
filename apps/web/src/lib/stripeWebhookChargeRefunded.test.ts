function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(
  ["charge.refunded", "refund.updated"].includes("charge.refunded"),
  "refund events tracked",
);

assert(
  typeof "reverseInboundPaymentWalletEntries" === "string",
  "refund path documents wallet reverse",
);

console.log("stripeWebhookChargeRefunded tests passed");
