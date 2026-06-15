import type { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import { readClientScopeQuery } from "@/lib/platformScopeApi";
import {
  resolveClientPlatformScope,
  resolvePlatformScopeFeatures,
} from "@/lib/platformScopeResolver";

export async function requireFoodClientAuth(req: NextRequest) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth;

  const scopeKey = await resolveClientPlatformScope(
    auth.supabaseAdmin,
    auth.user.id,
    readClientScopeQuery(req)
  );

  const features = scopeKey
    ? await resolvePlatformScopeFeatures(auth.supabaseAdmin, scopeKey)
    : null;

  if (!features?.restaurant_available) {
    return {
      ok: false as const,
      response: mmdLocationJson(
        {
          ok: false,
          error: "restaurant_unavailable",
          message: features?.message ?? "Restaurant ordering is unavailable in your market.",
        },
        403
      ),
    };
  }

  if (!features.checkout_enabled) {
    return {
      ok: false as const,
      response: mmdLocationJson(
        {
          ok: false,
          error: "checkout_disabled",
          message: features?.message ?? "Checkout is disabled in your market.",
        },
        403
      ),
    };
  }

  return {
    ok: true as const,
    ...auth,
    scope: features,
    scopeKey,
  };
}
