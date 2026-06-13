import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildClientFeaturesResponse,
} from "@/lib/platformScopeApi";
import { NextRequest } from "next/server";
import { buildSharedMissionContext } from "@/lib/ai/contexts/buildSharedMissionContext";
import type { ClientAiContextPayload } from "@/lib/ai/aiTypes";
export async function buildClientContext(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  locale: string;
  orderId?: string;
  req: NextRequest;
}): Promise<ClientAiContextPayload> {
  const featuresRes = await buildClientFeaturesResponse(
    params.supabaseAdmin,
    params.userId,
    params.req
  );

  let scopeLabel: string | null = null;
  let services = {
    taxi: false,
    delivery: false,
    restaurant: false,
    marketplace: false,
  };

  if (featuresRes.status === 200) {
    const body = (await featuresRes.clone().json()) as Record<string, unknown>;
    scopeLabel = typeof body.scope_label === "string" ? body.scope_label : null;
    services = {
      taxi: Boolean(body.taxi_available),
      delivery: Boolean(body.delivery_available),
      restaurant: Boolean(body.restaurant_available),
      marketplace: Boolean(body.marketplace_available),
    };
  }

  const mission = await buildSharedMissionContext({
    supabaseAdmin: params.supabaseAdmin,
    userId: params.userId,
    viewerRole: "client",
    orderId: params.orderId,
  });

  return {
    locale: params.locale,
    scopeLabel,
    services,
    mission: mission ?? undefined,
  };
}
