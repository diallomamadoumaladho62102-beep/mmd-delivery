import assert from "node:assert/strict";
import { isSafePublicImageUrl, safePublicImageSrc } from "./safeMediaUrl";

assert.equal(isSafePublicImageUrl("javascript:alert(1)"), false);
assert.equal(isSafePublicImageUrl("data:text/html,<script>x</script>"), false);
assert.equal(isSafePublicImageUrl("https://evil.example/logo.png"), false);
assert.equal(
  isSafePublicImageUrl("https://abc.supabase.co/storage/v1/object/public/x.png"),
  true
);
assert.equal(isSafePublicImageUrl("blob:https://www.mmddelivery.com/1"), true);
assert.equal(isSafePublicImageUrl("data:image/png;base64,abc"), true);
assert.equal(safePublicImageSrc("javascript:alert(1)"), null);
assert.equal(safePublicImageSrc("https://evil.example/logo.png"), null);
assert.equal(
  safePublicImageSrc("https://abc.supabase.co/storage/v1/object/public/x.png"),
  "https://abc.supabase.co/storage/v1/object/public/x.png",
);
assert.equal(safePublicImageSrc("blob:https://www.mmddelivery.com/1"), "blob:https://www.mmddelivery.com/1");

console.log("safeMediaUrl.test.ts OK");
