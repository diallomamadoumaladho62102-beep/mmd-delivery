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
  sanitizeInternalRedirectPath("/auth/callback?next=//x") === "/auth/callback?next=//x",
  "query preserved for same-origin path",
);

assert(isEmailVerificationRequired() === false, "email verification off by default");

process.env.REQUIRE_EMAIL_VERIFICATION = "true";
assert(isEmailVerificationRequired() === true, "email verification env respected");
delete process.env.REQUIRE_EMAIL_VERIFICATION;

console.log("authValidation tests passed");
