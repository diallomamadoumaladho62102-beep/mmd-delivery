import type { AiToolContext, AiToolResult } from "@/lib/ai/aiTypes";
import { searchPublicMmdHelp } from "@/lib/ai/searchMmdHelp";

export async function searchMmdHelp(
  ctx: AiToolContext,
  args: Record<string, unknown>
): Promise<AiToolResult> {
  const query = String(args.query ?? args.q ?? args.question ?? "").trim();
  if (!query) {
    return {
      ok: false,
      summary: "Ask a specific question about MMD Delivery so I can search the public help pages.",
    };
  }

  const result = await searchPublicMmdHelp({
    supabase: ctx.supabaseAdmin,
    query,
    locale: ctx.locale,
    limit: Number(args.limit ?? 5),
  });

  if (!result.hits.length) {
    return {
      ok: true,
      summary:
        "I did not find an official public MMD answer for that. I will not invent a rule. You can contact support or browse the FAQ.",
      data: { hits: [], invented: false },
      actions: [
        {
          type: "navigate",
          label: "Contact support",
          route: "ClientInbox",
          params: {},
        },
      ],
    };
  }

  const lines = result.hits.map((hit) => `${hit.title}: ${hit.excerpt}`).join(" ");
  return {
    ok: true,
    summary: lines.slice(0, 900),
    data: {
      hits: result.hits,
      localeUsed: result.localeUsed,
      invented: false,
      sources: "public_faq_and_cms_only",
    },
  };
}
