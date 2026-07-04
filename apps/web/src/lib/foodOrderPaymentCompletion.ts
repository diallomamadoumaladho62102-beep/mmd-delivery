import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyClientOrderCreated } from "@/lib/clientPushNotifications";
import { runFoodOrderPaymentSideEffects } from "@/lib/restaurantOrderAutomation";

export async function completeFoodOrderAfterPayment(
  supabaseAdmin: SupabaseClient,
  input: {
    orderId: string;
    clientUserIds: Array<string | null | undefined>;
    kind?: string | null;
    dispatchOrigin?: string | null;
  },
): Promise<void> {
  await notifyClientOrderCreated({
    supabaseAdmin,
    userIds: input.clientUserIds,
    orderId: input.orderId,
    kind: input.kind,
  });

  await runFoodOrderPaymentSideEffects(supabaseAdmin, {
    orderId: input.orderId,
    dispatchOrigin: input.dispatchOrigin ?? null,
    notifyClientPaid: false,
    notifyRestaurant: true,
  });
}
