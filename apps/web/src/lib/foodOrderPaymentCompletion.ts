import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyClientOrderCreated } from "@/lib/clientPushNotifications";
import { runFoodOrderPaymentSideEffects } from "@/lib/restaurantOrderAutomation";
import { notifyOrderConfirmationEmail } from "@/lib/transactionalEmails";

export async function completeFoodOrderAfterPayment(
  supabaseAdmin: SupabaseClient,
  input: {
    orderId: string;
    clientUserIds: Array<string | null | undefined>;
    kind?: string | null;
    dispatchOrigin?: string | null;
    restaurantName?: string | null;
  },
): Promise<void> {
  await notifyClientOrderCreated({
    supabaseAdmin,
    userIds: input.clientUserIds,
    orderId: input.orderId,
    kind: input.kind,
  });

  const clientUserId =
    input.clientUserIds.find((id) => String(id ?? "").trim().length > 0) ?? null;

  await notifyOrderConfirmationEmail({
    supabaseAdmin,
    clientUserId: clientUserId ? String(clientUserId) : null,
    orderId: input.orderId,
    restaurantName: input.restaurantName ?? null,
  });

  await runFoodOrderPaymentSideEffects(supabaseAdmin, {
    orderId: input.orderId,
    dispatchOrigin: input.dispatchOrigin ?? null,
    notifyClientPaid: false,
    notifyRestaurant: true,
  });
}
