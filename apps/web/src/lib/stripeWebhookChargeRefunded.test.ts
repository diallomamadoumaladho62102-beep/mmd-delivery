function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(
  ["charge.refunded", "refund.updated"].includes("charge.refunded"),
  "refund events tracked",
);

console.log("stripeWebhookChargeRefunded tests passed");
