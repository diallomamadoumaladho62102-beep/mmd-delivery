import type { SupabaseClient } from "@supabase/supabase-js";
import {
  notifyClientWaitFeeStarted,
  notifyClientWaitFinalWarning,
  notifyClientDriverArrived,
} from "@/lib/clientPushNotifications";
import type { WaitTimerEntityType } from "@/lib/waitTimerTypes";
import { markWaitTimerNotificationSent } from "@/lib/waitTimerService";

export async function processWaitTimerClientNotifications(
  supabaseAdmin: SupabaseClient,
  input: {
    entityType: WaitTimerEntityType;
    entityId: string;
    clientUserIds: string[];
    entityKind: "delivery" | "taxi";
    timer: {
      remaining_free_seconds: number;
      can_charge_fees: boolean;
      max_fee_reached: boolean;
    };
    notificationFlags: {
      arrived: string | null;
      fee_started: string | null;
      final_warning: string | null;
    };
    justArrived?: boolean;
  }
) {
  const userIds = input.clientUserIds.filter(Boolean);
  if (userIds.length === 0) return;

  if (input.justArrived && !input.notificationFlags.arrived) {
    await notifyClientDriverArrived({
      supabaseAdmin,
      userIds,
      entityType: input.entityType,
      entityId: input.entityId,
      entityKind: input.entityKind,
    });
    await markWaitTimerNotificationSent(supabaseAdmin, {
      entityType: input.entityType,
      entityId: input.entityId,
      field: "client_wait_arrived_notified_at",
    });
  }

  if (
    input.timer.can_charge_fees &&
    !input.notificationFlags.fee_started
  ) {
    await notifyClientWaitFeeStarted({
      supabaseAdmin,
      userIds,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    await markWaitTimerNotificationSent(supabaseAdmin, {
      entityType: input.entityType,
      entityId: input.entityId,
      field: "client_wait_fee_started_notified_at",
    });
  }

  if (
    input.timer.max_fee_reached &&
    !input.notificationFlags.final_warning
  ) {
    await notifyClientWaitFinalWarning({
      supabaseAdmin,
      userIds,
      entityType: input.entityType,
      entityId: input.entityId,
      entityKind: input.entityKind,
    });
    await markWaitTimerNotificationSent(supabaseAdmin, {
      entityType: input.entityType,
      entityId: input.entityId,
      field: "client_wait_final_warning_notified_at",
    });
  }
}
