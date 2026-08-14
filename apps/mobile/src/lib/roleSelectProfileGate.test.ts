import assert from "node:assert/strict";
import {
  classifyProfileFetchError,
  fetchOwnProfileForRoleGate,
  userMessageForProfileGateKind,
} from "./roleSelectProfileGate";

assert.equal(
  classifyProfileFetchError({ message: "JWT expired" }),
  "session_expired",
);
assert.equal(
  classifyProfileFetchError({ code: "PGRST301", message: "JWT expired" }),
  "session_expired",
);
assert.equal(
  classifyProfileFetchError({ message: "Network request failed" }),
  "network",
);
assert.equal(
  classifyProfileFetchError({
    message: "new row violates row-level security policy",
  }),
  "permission",
);
assert.equal(
  classifyProfileFetchError({ message: "Database error", code: "57014" }),
  "server",
);

assert.match(
  userMessageForProfileGateKind("session_expired"),
  /sign in again/i,
);
assert.match(userMessageForProfileGateKind("network"), /Network error/i);

async function runFetchTests() {
  const okClient = {
    auth: {
      async getUser() {
        return { data: { user: { id: "u1" } }, error: null };
      },
      async refreshSession() {
        return { data: { session: null }, error: { message: "unused" } };
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: { role: "client", is_founder: false },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const ok = await fetchOwnProfileForRoleGate(okClient as any);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.profile?.role, "client");
    assert.equal(ok.userId, "u1");
  }

  let refreshed = false;
  let profileCalls = 0;
  const jwtThenOk = {
    auth: {
      async getUser() {
        return { data: { user: { id: "u2" } }, error: null };
      },
      async refreshSession() {
        refreshed = true;
        return {
          data: { session: { user: { id: "u2" } } },
          error: null,
        };
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  profileCalls += 1;
                  if (profileCalls === 1) {
                    return {
                      data: null,
                      error: { code: "PGRST301", message: "JWT expired" },
                    };
                  }
                  return {
                    data: { role: "driver", is_founder: false },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const recovered = await fetchOwnProfileForRoleGate(jwtThenOk as any);
  assert.equal(recovered.ok, true);
  assert.equal(refreshed, true);
  if (recovered.ok) assert.equal(recovered.profile?.role, "driver");

  const expiredAuth = {
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: { message: "Auth session missing" },
        };
      },
      async refreshSession() {
        return {
          data: { session: null },
          error: { message: "Invalid Refresh Token" },
        };
      },
    },
    from() {
      throw new Error("profiles must not be queried when auth fails");
    },
  };

  const failed = await fetchOwnProfileForRoleGate(expiredAuth as any);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.kind, "session_expired");
  }

  console.log("roleSelectProfileGate tests passed");
}

void runFetchTests();
