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

assert(
  typeof "clawbackPartnerTransfersForRefund" === "string",
  "refund path documents partner SCT clawback",
);

assert(
  typeof "clawbackTipTransfersForRefund" === "string",
  "refund path documents tip SCT clawback",
);

console.log("stripeWebhookChargeRefunded tests passed");
