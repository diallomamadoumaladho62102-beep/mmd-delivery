import { NextRequest } from "next/server";
import {
  buildClientFeaturesResponse,
  requirePlatformFeaturesAuth,
} from "@/lib/platformScopeApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePlatformFeaturesAuth(req);
  if (auth.ok === false) return auth.response;
  return buildClientFeaturesResponse(auth.supabaseAdmin, auth.userId, req);
}
