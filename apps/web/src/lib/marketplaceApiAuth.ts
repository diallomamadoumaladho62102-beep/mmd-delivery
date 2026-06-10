import type { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import { readClientScopeQuery } from "@/lib/platformScopeApi";
import {
  resolveClientPlatformScope,
  resolvePlatformScopeFeatures,
} from "@/lib/platformScopeResolver";

export async function requireMarketplaceClientAuth(req: NextRequest) {
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

  if (!features?.marketplace_available) {
    return {
      ok: false as const,
      response: mmdLocationJson(
        {
          ok: false,
          error: "marketplace_unavailable",
          message: features?.message ?? null,
        },
        403
      ),
    };
  }

  return { ok: true as const, ...auth, scope: features };
}
