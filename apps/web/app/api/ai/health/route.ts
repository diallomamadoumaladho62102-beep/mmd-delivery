import type { NextRequest } from "next/server";
import { isAiAssistantEnabled, getOpenAiModel } from "@/lib/ai/aiConfig";
import { aiJson } from "@/lib/ai/aiJson";
import { requireAiHealthEnv } from "@/lib/ai/requireAiApiUser";
import { adminAiDomainPlan } from "@/lib/ai/domains/adminAiDomain";
import { isInternalHealthAuthorized } from "@/lib/internalHealthAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isInternalHealthAuthorized(req)) {
    return aiJson({ ok: false, error: "Unauthorized" }, 401);
  }

  const env = requireAiHealthEnv();
  if (env.ok === false) return env.response;

  return aiJson({
    ok: true,
    service: "mmd-ai",
    model: getOpenAiModel(),
    assistantEnabled: isAiAssistantEnabled(),
    phase: "1-backend-foundation",
    clientOnly: true,
    adminAi: adminAiDomainPlan.status,
  });
}
