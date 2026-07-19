import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyClientOrderCreated } from "@/lib/clientPushNotifications";
import { runFoodOrderPaymentSideEffects } from "@/lib/restaurantOrderAutomation";
import { notifyOrderConfirmationEmail } from "@/lib/transactionalEmails";
import { captureEntityCredit } from "@/lib/loyalty/loyaltyCredit";

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

  // Crédit MMD: finalize any reserved store-credit now that the order is paid.
  await captureEntityCredit(supabaseAdmin, "food_order", input.orderId);

  // Phase 7.1: capture marketing reservation once (idempotent).
  try {
    const { captureEntityMarketing } = await import(
      "@/lib/marketing/marketingCheckoutLifecycle"
    );
    await captureEntityMarketing(supabaseAdmin, "food", input.orderId);
  } catch (e) {
    console.warn(
      "[marketing] food capture fail-open",
      e instanceof Error ? e.message : e
    );
  }
}
