import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyClientGenericPush } from "@/lib/mmdPlus/mmdPlusPush";
import { notifyUserTransactional } from "@/lib/transactionalOutbound";

export async function notifyMarketingClient(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  title: string;
  body: string;
  event: string;
}) {
  try {
    await notifyClientGenericPush({
      supabaseAdmin: params.supabaseAdmin,
      userIds: [params.userId],
      title: params.title,
      body: params.body,
      data: { type: `marketing_${params.event}`, module: "marketing" },
    });
  } catch (e) {
    console.warn("[marketing] push failed", e instanceof Error ? e.message : e);
  }
  try {
    await notifyUserTransactional({
      supabaseAdmin: params.supabaseAdmin,
      recipient: { userId: params.userId },
      subject: params.title,
      body: params.body,
      html: `<p>${params.body}</p>`,
    });
  } catch (e) {
    console.warn("[marketing] email failed", e instanceof Error ? e.message : e);
  }
}
