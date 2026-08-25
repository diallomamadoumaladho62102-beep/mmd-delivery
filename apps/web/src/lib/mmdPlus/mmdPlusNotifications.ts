import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyClientGenericPush } from "@/lib/mmdPlus/mmdPlusPush";
import { notifyUserTransactional } from "@/lib/transactionalOutbound";
import { mmdPlusEventKey, pushText } from "@/lib/pushCopy";
import { loadPreferredLocale } from "@/lib/userLocale";

export type MmdPlusNotifyEvent =
  | "created"
  | "trial_started"
  | "trial_ended"
  | "payment_succeeded"
  | "payment_failed"
  | "renewed"
  | "expired"
  | "plan_changed"
  | "canceled";

/** Best-effort notifications via existing push + transactional email. */
export async function notifyMmdPlusEvent(
  supabaseAdmin: SupabaseClient,
  params: { userId: string; event: MmdPlusNotifyEvent; detail?: string }
): Promise<void> {
  const locale = await loadPreferredLocale(supabaseAdmin, params.userId);
  const copy = pushText(mmdPlusEventKey(params.event), locale);
  const body = params.detail ? `${copy.body} ${params.detail}` : copy.body;

  try {
    await notifyClientGenericPush({
      supabaseAdmin,
      userIds: [params.userId],
      title: copy.title,
      body,
      data: { type: `mmd_plus_${params.event}`, module: "mmd_plus" },
    });
  } catch (e) {
    console.warn("[mmd-plus] push notify failed", e instanceof Error ? e.message : e);
  }

  try {
    await notifyUserTransactional({
      supabaseAdmin,
      recipient: { userId: params.userId },
      subject: copy.title,
      body,
      html: `<p>${body}</p>`,
    });
  } catch (e) {
    console.warn("[mmd-plus] email notify failed", e instanceof Error ? e.message : e);
  }
}
