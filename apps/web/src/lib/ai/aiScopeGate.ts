import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAiDailyCostCapUsdEnv,
  getAiInternalBetaUserIds,
  isAiAssistantEnabled,
  isAiEmergencyStopEnv,
  isAiInternalBetaUser,
} from "@/lib/ai/aiConfig";
import { aiJson } from "@/lib/ai/aiJson";
import { fetchAiRuntimeSettings } from "@/lib/ai/aiRuntimeSettings";
import { logAiStructured } from "@/lib/ai/aiStructuredLog";
import {
  fetchPlatformScopeConfig,
  resolveClientPlatformScope,
} from "@/lib/platformScopeResolver";
import type { PlatformScopeKey } from "@/lib/platformScopeTypes";

export type AiScopeContext = {
  scope: PlatformScopeKey;
  countryCode: string;
  regionCode: string | null;
  stateCode: string | null;
  aiEnabledForScope: boolean;
  internalBetaBypass: boolean;
};

export type AiGuardFailure = {
  ok: false;
  response: ReturnType<typeof aiJson>;
  errorCode: string;
  logEvent?: "mmd_ai_cost_cap_reached";
};

export type AiGuardSuccess = {
  ok: true;
  scopeContext: AiScopeContext;
};

async function getEffectiveDailyCostCap(
  supabaseAdmin: SupabaseClient
): Promise<number | null> {
  const envCap = getAiDailyCostCapUsdEnv();
  const settings = await fetchAiRuntimeSettings(supabaseAdmin);
  return settings.dailyCostCapUsdDb ?? envCap;
}

async function isEmergencyStopActive(supabaseAdmin: SupabaseClient): Promise<boolean> {
  if (isAiEmergencyStopEnv()) return true;
  const settings = await fetchAiRuntimeSettings(supabaseAdmin);
  return settings.emergencyStopDb;
}

async function getDailyCostUsd(supabaseAdmin: SupabaseClient): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("get_ai_daily_cost_usd");
  if (error) {
    console.error("[aiScopeGate] get_ai_daily_cost_usd failed", error.message);
    return 0;
  }
  const value = Number(data ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export async function resolveAiScopeContext(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  req: NextRequest;
}): Promise<AiScopeContext> {
  const scope = await resolveClientPlatformScope(params.supabaseAdmin, params.userId, {});
  const config = await fetchPlatformScopeConfig(params.supabaseAdmin, scope);
  const internalBetaBypass = isAiInternalBetaUser(params.userId);

  return {
    scope,
    countryCode: scope.country_code,
    regionCode: scope.region_code,
    stateCode: scope.state_code,
    aiEnabledForScope: Boolean(config?.ai_enabled),
    internalBetaBypass,
  };
}

export async function assertAiOperational(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  req: NextRequest;
}): Promise<AiGuardSuccess | AiGuardFailure> {
  if (!isAiAssistantEnabled()) {
    return {
      ok: false,
      errorCode: "AI_DISABLED",
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

  if (await isEmergencyStopActive(params.supabaseAdmin)) {
    return {
      ok: false,
      errorCode: "AI_TEMPORARILY_DISABLED",
      response: aiJson(
        {
          ok: false,
          error: "MMD AI is temporarily unavailable.",
          code: "AI_TEMPORARILY_DISABLED",
        },
        503
      ),
    };
  }

  const costCap = await getEffectiveDailyCostCap(params.supabaseAdmin);
  if (costCap != null) {
    const spentToday = await getDailyCostUsd(params.supabaseAdmin);
    if (spentToday >= costCap) {
      logAiStructured({
        event: "mmd_ai_cost_cap_reached",
        ts: new Date().toISOString(),
        userId: params.userId,
        estimatedCostUsd: spentToday,
        errorCode: "AI_TEMPORARILY_DISABLED",
      });

      try {
        await params.supabaseAdmin.from("ai_events").insert({
          event_type: "mmd_ai_cost_cap_reached",
          user_id: params.userId,
          error_code: "AI_TEMPORARILY_DISABLED",
          estimated_cost_usd: spentToday,
        });
      } catch {
        // metrics must not block response
      }

      return {
        ok: false,
        errorCode: "AI_TEMPORARILY_DISABLED",
        logEvent: "mmd_ai_cost_cap_reached",
        response: aiJson(
          {
            ok: false,
            error: "MMD AI is temporarily unavailable.",
            code: "AI_TEMPORARILY_DISABLED",
          },
          503
        ),
      };
    }
  }

  const scopeContext = await resolveAiScopeContext(params);

  if (!scopeContext.aiEnabledForScope && !scopeContext.internalBetaBypass) {
    return {
      ok: false,
      errorCode: "AI_NOT_AVAILABLE_IN_REGION",
      response: aiJson(
        {
          ok: false,
          error: "MMD AI is not available in your area yet.",
          code: "AI_NOT_AVAILABLE_IN_REGION",
        },
        403
      ),
    };
  }

  return { ok: true, scopeContext };
}

export async function getAiAdminControlSnapshot(supabaseAdmin: SupabaseClient) {
  const settings = await fetchAiRuntimeSettings(supabaseAdmin);
  const envCap = getAiDailyCostCapUsdEnv();
  const effectiveCap = settings.dailyCostCapUsdDb ?? envCap;
  const emergencyStop = isAiEmergencyStopEnv() || settings.emergencyStopDb;

  const [metricsRes, costRes, regionsRes] = await Promise.all([
    supabaseAdmin.rpc("get_ai_metrics", { p_period: "today" }),
    supabaseAdmin.rpc("get_ai_daily_cost_usd"),
    supabaseAdmin.rpc("get_ai_active_regions_count"),
  ]);

  return {
    globalEnabled: isAiAssistantEnabled(),
    emergencyStop,
    emergencyStopEnv: isAiEmergencyStopEnv(),
    emergencyStopDb: settings.emergencyStopDb,
    costTodayUsd: Number(costRes.data ?? 0),
    costCapUsd: effectiveCap,
    costCapEnvUsd: envCap,
    costCapDbUsd: settings.dailyCostCapUsdDb,
    activeRegions: Number(regionsRes.data ?? 0),
    metricsToday: metricsRes.data ?? null,
    internalBetaUserCount: getAiInternalBetaUserIds().size,
  };
}
