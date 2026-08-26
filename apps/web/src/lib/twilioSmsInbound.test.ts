import assert from "node:assert/strict";
import { buildSmsTwiml } from "./twilioSmsInbound";

const empty = buildSmsTwiml(null);
assert.match(empty, /<Response><\/Response>/);
assert.doesNotMatch(empty, /<Message>/);

const help = buildSmsTwiml("MMD Delivery: Help — support@mmddelivery.com");
assert.match(help, /<Message>MMD Delivery: Help/);
assert.match(buildSmsTwiml("A & B <C>"), /A &amp; B &lt;C&gt;/);

console.log("twilioSmsInbound.test.ts — PASS");
