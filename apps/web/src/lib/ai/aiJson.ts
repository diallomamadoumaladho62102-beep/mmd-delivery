import { NextResponse } from "next/server";
import type { AiChatResponse, AiErrorResponse } from "@/lib/ai/aiTypes";

export function aiJson(body: AiChatResponse | AiErrorResponse | Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
