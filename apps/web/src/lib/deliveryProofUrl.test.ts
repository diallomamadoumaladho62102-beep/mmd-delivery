import assert from "node:assert/strict";
import {
  extractDeliveryProofStoragePath,
  normalizeDeliveryProofPhotoUrl,
} from "@/lib/deliveryProofUrl";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc123.supabase.co";

const orderId = "11111111-1111-4111-8111-111111111111";
const driverId = "22222222-2222-4222-8222-222222222222";
const validPath = `${orderId}/${driverId}/pickup-1234567890-0.abc123.jpg`;

assert.equal(extractDeliveryProofStoragePath(validPath), validPath);

assert.equal(
  extractDeliveryProofStoragePath(
    `https://abc123.supabase.co/storage/v1/object/sign/delivery-proofs/${validPath}?token=abc`
  ),
  validPath
);

assert.equal(extractDeliveryProofStoragePath("https://evil.example/photo.jpg"), null);
assert.equal(extractDeliveryProofStoragePath("https://abc123.supabase.co/other"), null);

assert.equal(
  normalizeDeliveryProofPhotoUrl(validPath, { orderId }),
  validPath
);

try {
  normalizeDeliveryProofPhotoUrl(validPath, {
    orderId: "33333333-3333-4333-8333-333333333333",
  });
  assert.fail("expected order mismatch to throw");
} catch (e) {
  assert.match(String(e), /Invalid proof_photo_url/);
}

console.log("deliveryProofUrl tests passed");
