import assert from "node:assert/strict";
import { MMD_SECURITY_HEADERS, securityHeaderMap } from "./securityHeaders";

assert.ok(MMD_SECURITY_HEADERS.length >= 6);
const map = securityHeaderMap();
assert.equal(map["X-Frame-Options"], "DENY");
assert.equal(map["X-Content-Type-Options"], "nosniff");
assert.match(map["Strict-Transport-Security"] ?? "", /max-age=/);
assert.match(map["Content-Security-Policy"] ?? "", /frame-ancestors 'none'/);
assert.match(map["Content-Security-Policy"] ?? "", /object-src 'none'/);

console.log("securityHeaders tests passed");
