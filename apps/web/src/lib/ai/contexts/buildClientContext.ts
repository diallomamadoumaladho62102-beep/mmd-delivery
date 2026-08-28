import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientAiContextPayload } from "@/lib/ai/aiTypes";
import { buildSharedMissionContext } from "@/lib/ai/contexts/buildSharedMissionContext";
import {
  resolveClientPlatformScope,
  resolvePlatformScopeFeatures,
} from "@/lib/platformScopeResolver";

export type BuildClientContextInput = {
  supabaseAdmin: SupabaseClient;
  userId: string;
  locale: string;
  orderId?: string;
  req?: NextRequest;
};

export async function buildClientContext(
  input: BuildClientContextInput
): Promise<ClientAiContextPayload> {
  const locale = String(input.locale ?? "en").split("-")[0].slice(0, 8) || "en";

  const scope = await resolveClientPlatformScope(input.supabaseAdmin, input.userId, {});
  const features = await resolvePlatformScopeFeatures(input.supabaseAdmin, scope);

  const payload: ClientAiContextPayload = {
    locale,
    scopeLabel: features?.scope_label ?? null,
    services: {
      taxi: features?.taxi_available === true,
      delivery: features?.delivery_available === true,
      restaurant: features?.restaurant_available === true,
      marketplace: features?.marketplace_available === true,
    },
  };

  const orderId = String(input.orderId ?? "").trim();
  if (orderId) {
    const mission = await buildSharedMissionContext({
      supabaseAdmin: input.supabaseAdmin,
      userId: input.userId,
      viewerRole: "client",
      orderId,
    });
    if (mission) payload.mission = mission;
  }

  return payload;
}
