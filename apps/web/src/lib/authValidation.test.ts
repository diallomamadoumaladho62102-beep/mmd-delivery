import {
  isEmailVerificationRequired,
  sanitizeInternalRedirectPath,
  validatePassword,
} from "./authValidation";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(
  validatePassword("short") === "Password must be at least 8 characters.",
  "short password rejected",
);
assert(validatePassword("longenough") === null, "valid password accepted");

assert(
  sanitizeInternalRedirectPath("/orders") === "/orders",
  "relative path allowed",
);
assert(
  sanitizeInternalRedirectPath("//evil.com") === "/dashboard",
  "protocol-relative blocked",
);
assert(
  sanitizeInternalRedirectPath("https://evil.com") === "/dashboard",
  "absolute url blocked",
);
assert(
  sanitizeInternalRedirectPath("/auth/callback?next=//x") === "/auth/callback",
  "nested open redirect stripped from query",
);
assert(
  sanitizeInternalRedirectPath("/%2f%2fevil.com") === "/dashboard",
  "encoded protocol-relative blocked",
);
assert(
  sanitizeInternalRedirectPath("/orders?tab=1") === "/orders?tab=1",
  "safe query preserved",
);

assert(isEmailVerificationRequired() === false, "email verification off by default");

process.env.REQUIRE_EMAIL_VERIFICATION = "true";
assert(isEmailVerificationRequired() === true, "email verification env respected");
delete process.env.REQUIRE_EMAIL_VERIFICATION;

console.log("authValidation tests passed");
