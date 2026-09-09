import assert from "node:assert/strict";
import { MMD_SECURITY_HEADERS, securityHeaderMap } from "./securityHeaders";

assert.ok(MMD_SECURITY_HEADERS.length >= 6);
const map = securityHeaderMap();
assert.equal(map["X-Frame-Options"], "DENY");
assert.equal(map["X-Content-Type-Options"], "nosniff");
assert.equal(map["Cross-Origin-Opener-Policy"], "same-origin");
assert.equal(map["Cross-Origin-Resource-Policy"], "same-origin");
assert.equal(map["Cross-Origin-Embedder-Policy"], undefined);
assert.match(map["Strict-Transport-Security"] ?? "", /max-age=/);
assert.match(map["Content-Security-Policy"] ?? "", /frame-ancestors 'none'/);
assert.match(map["Content-Security-Policy"] ?? "", /object-src 'none'/);
const csp = map["Content-Security-Policy"] ?? "";
assert.doesNotMatch(csp, /img-src[^;]*\shttps:(?:\s|;|$)/);
assert.doesNotMatch(csp, /media-src[^;]*\shttps:(?:\s|;|$)/);
assert.doesNotMatch(csp, /font-src[^;]*\shttps:(?:\s|;|$)/);
assert.doesNotMatch(csp, /style-src[^;]*\shttps:(?:\s|;|$)/);
assert.match(csp, /connect-src 'self' https: wss:/);

console.log("securityHeaders tests passed");
