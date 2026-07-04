/** MMD push sound filenames — Deno edge functions. Keep in sync with apps/web/src/lib/mmdPushSounds.ts */
export const MMD_PUSH_SOUNDS = {
  driverRing: "mmd_signature_driver_60s.wav",
  restaurantRing: "mmd_signature_restaurant_120s.wav",
  client: "mmd_signature_client.wav",
  chat: "mmd_chat_notification.wav",
  paymentSuccess: "mmd_payment_success.wav",
  paymentFailed: "mmd_payment_failed.wav",
  success: "mmd_success.wav",
  error: "mmd_error.wav",
  warning: "mmd_warning.wav",
  promo: "mmd_promo.wav",
  reward: "mmd_reward.wav",
  system: "mmd_system_notification.wav",
  rideAccepted: "mmd_ride_accepted.wav",
  orderAccepted: "mmd_order_accepted.wav",
  driverArrived: "mmd_driver_arrived.wav",
  deliveryCompleted: "mmd_delivery_completed.wav",
} as const;

export function resolvePushSound(dataType?: string | null): string {
  const type = String(dataType ?? "").trim().toLowerCase();

  switch (type) {
    case "driver_offer":
    case "delivery_offer":
    case "taxi_offer":
    case "marketplace_offer":
    case "scheduled_mission":
    case "order_reassigned":
      return MMD_PUSH_SOUNDS.driverRing;
    case "restaurant_order":
    case "restaurant_order_update":
    case "scheduled_order":
      return MMD_PUSH_SOUNDS.restaurantRing;
    case "order_paid":
    case "delivery_request_paid":
    case "client_update":
    case "driver_en_route":
      return MMD_PUSH_SOUNDS.client;
    case "chat":
    case "order_message":
      return MMD_PUSH_SOUNDS.chat;
    case "payment_success":
      return MMD_PUSH_SOUNDS.paymentSuccess;
    case "payment_failed":
      return MMD_PUSH_SOUNDS.paymentFailed;
    case "order_cancelled":
    case "delivery_request_cancelled":
      return MMD_PUSH_SOUNDS.warning;
    case "driver_arrived":
      return MMD_PUSH_SOUNDS.driverArrived;
    case "order_accepted":
    case "ride_accepted":
      return MMD_PUSH_SOUNDS.orderAccepted;
    case "delivered":
    case "delivery_completed":
      return MMD_PUSH_SOUNDS.deliveryCompleted;
    case "wait_fee_started":
    case "wait_final_warning":
      return MMD_PUSH_SOUNDS.warning;
    case "promo":
    case "promotion":
      return MMD_PUSH_SOUNDS.promo;
    case "reward":
    case "wallet":
      return MMD_PUSH_SOUNDS.reward;
    default:
      return MMD_PUSH_SOUNDS.system;
  }
}
