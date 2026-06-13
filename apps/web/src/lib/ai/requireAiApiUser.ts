import type { NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  getBearerToken,
  getProfileRole,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  taxiJson,
} from "@/lib/taxiApi";
import { isAiAssistantEnabled } from "@/lib/ai/aiConfig";
import { aiJson } from "@/lib/ai/aiJson";
import type { AiRole } from "@/lib/ai/aiTypes";

export type AiApiAuthSuccess = {
  ok: true;
  user: User;
  token: string;
  role: Awaited<ReturnType<typeof getProfileRole>>;
  aiRole: AiRole;
  supabaseUser: SupabaseClient;
  supabaseAdmin: SupabaseClient;
};

export type AiApiAuthFailure = {
  ok: false;
  response: ReturnType<typeof aiJson>;
};

function mapProfileRoleToAiRole(role: string): AiRole | null {
  switch (role) {
    case "client":
      return "client";
    case "driver":
      return "driver";
    case "restaurant":
      return "restaurant";
    case "admin":
    case "ops":
    case "support":
    case "finance":
    case "review":
      return "admin";
    default:
      return null;
  }
}

export async function requireAiApiUser(
  req: NextRequest,
  options?: { clientOnly?: boolean }
): Promise<AiApiAuthSuccess | AiApiAuthFailure> {
  if (!isAiAssistantEnabled()) {
    return {
      ok: false,
      response: aiJson(
        {
          ok: false,
          error: "MMD AI is not available yet.",
          code: "AI_DISABLED",
        },
        403
      ),
    };
  }

  const token = getBearerToken(req);
  if (!token) {
    return {
      ok: false,
      response: aiJson(
        { ok: false, error: "Missing Authorization Bearer token", code: "UNAUTHORIZED" },
        401
      ),
    };
  }

  const supabaseUser = getSupabaseUserClient(token);
  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseUser.auth.getUser();
  const user = data?.user;

  if (error || !user?.id) {
    return {
      ok: false,
      response: aiJson({ ok: false, error: "Invalid token", code: "UNAUTHORIZED" }, 401),
    };
  }

  let role: Awaited<ReturnType<typeof getProfileRole>>;
  try {
    role = await getProfileRole(supabaseAdmin, user.id);
  } catch (err) {
    return {
      ok: false,
      response: aiJson(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Unable to resolve profile role",
          code: "AI_UNAVAILABLE",
        },
        500
      ),
    };
  }

  const aiRole = mapProfileRoleToAiRole(role);
  if (!aiRole) {
    return {
      ok: false,
      response: aiJson(
        { ok: false, error: "Forbidden: unsupported role for MMD AI", code: "FORBIDDEN_ROLE" },
        403
      ),
    };
  }

  if (options?.clientOnly && aiRole !== "client") {
    return {
      ok: false,
      response: aiJson(
        {
          ok: false,
          error: "MMD AI client assistant is not enabled for this role yet.",
          code: "FORBIDDEN_ROLE",
        },
        403
      ),
    };
  }

  return { ok: true, user, token, role, aiRole, supabaseUser, supabaseAdmin };
}

/** Health checks may bypass feature flag but still need valid env. */
export function requireAiHealthEnv(): { ok: true } | { ok: false; response: ReturnType<typeof taxiJson> } {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return {
      ok: false,
      response: taxiJson({ ok: false, error: "OPENAI_API_KEY not configured" }, 503),
    };
  }
  return { ok: true };
}
