import assert from "node:assert/strict";
import { isSafePublicImageUrl } from "./safeMediaUrl";

assert.equal(isSafePublicImageUrl("javascript:alert(1)"), false);
assert.equal(isSafePublicImageUrl("data:text/html,<script>x</script>"), false);
assert.equal(isSafePublicImageUrl("https://evil.example/logo.png"), false);
assert.equal(
  isSafePublicImageUrl("https://abc.supabase.co/storage/v1/object/public/x.png"),
  true
);
assert.equal(isSafePublicImageUrl("blob:https://www.mmddelivery.com/1"), true);
assert.equal(isSafePublicImageUrl("data:image/png;base64,abc"), true);

console.log("safeMediaUrl.test.ts OK");
