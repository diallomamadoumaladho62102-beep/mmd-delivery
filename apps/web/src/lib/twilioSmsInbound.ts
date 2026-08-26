import type { SupabaseClient } from "@supabase/supabase-js";
import { classifySmsKeyword } from "@/lib/smsKeywords";
import {
  applyInboundStart,
  applyInboundStop,
} from "@/lib/smsConsent";
import { renderSmsTemplate } from "@/lib/smsTemplates";

export function buildSmsTwiml(message: string | null): string {
  if (!message) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
  }
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escaped}</Message>
</Response>`;
}

export async function handleInboundSmsBody(params: {
  supabase: SupabaseClient;
  from: string;
  body: string;
}): Promise<{ twiml: string; keyword: ReturnType<typeof classifySmsKeyword> }> {
  const keyword = classifySmsKeyword(params.body);

  if (keyword === "stop") {
    await applyInboundStop(params.supabase, params.from, params.body.trim());
    return {
      keyword,
      twiml: buildSmsTwiml(renderSmsTemplate("stop_confirm")),
    };
  }

  if (keyword === "help") {
    return {
      keyword,
      twiml: buildSmsTwiml(renderSmsTemplate("help")),
    };
  }

  if (keyword === "start") {
    const started = await applyInboundStart(params.supabase, params.from);
    if (started.ok && started.restored) {
      return {
        keyword,
        twiml: buildSmsTwiml(renderSmsTemplate("start_confirm")),
      };
    }
    return {
      keyword,
      twiml: buildSmsTwiml(renderSmsTemplate("start_needs_cta")),
    };
  }

  return { keyword, twiml: buildSmsTwiml(null) };
}
