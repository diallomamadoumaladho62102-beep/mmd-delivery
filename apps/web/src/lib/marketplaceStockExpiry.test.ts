import assert from "node:assert/strict";
import { MARKETPLACE_CHECKOUT_SESSION_TTL_MS, marketplaceStockReservationCutoffIso } from "./marketplaceStockService";
import { EXPIRE_SAFETY_MARGIN_MS } from "./expireStalePayments";

const nowMs = Date.parse("2026-07-13T12:00:00.000Z");
const cutoff = marketplaceStockReservationCutoffIso(nowMs);
const reservedAt = new Date(nowMs - MARKETPLACE_CHECKOUT_SESSION_TTL_MS - EXPIRE_SAFETY_MARGIN_MS - 60_000).toISOString();
const recentReserved = new Date(nowMs - MARKETPLACE_CHECKOUT_SESSION_TTL_MS).toISOString();

assert.equal(Date.parse(cutoff), nowMs - MARKETPLACE_CHECKOUT_SESSION_TTL_MS - EXPIRE_SAFETY_MARGIN_MS);
assert.ok(Date.parse(reservedAt) < Date.parse(cutoff), "stale reservation is before cutoff");
assert.ok(Date.parse(recentReserved) > Date.parse(cutoff), "recent reservation is after cutoff");

console.log("marketplaceStockExpiry.test.ts — PASS");
