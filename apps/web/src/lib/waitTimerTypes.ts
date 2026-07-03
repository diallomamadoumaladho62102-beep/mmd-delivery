export const WAIT_TIMER_FREE_MINUTES = 5;

export const WAIT_FEE_TIER1_RATE_CENTS = 25; // $0.25/min
export const WAIT_FEE_TIER1_MINUTES = 3;

export const WAIT_FEE_TIER2_RATE_CENTS = 30; // $0.30/min
export const WAIT_FEE_TIER2_MINUTES = 5;

export const WAIT_FEE_MAX_CENTS = 225; // $2.25

export const DRIVER_ARRIVAL_MAX_METERS = 50;
export const DRIVER_ARRIVAL_MANUAL_REVIEW_METERS = 150;

export const WAIT_TIMER_ENTITY_TYPES = ["order", "delivery_request", "taxi_ride"] as const;
export type WaitTimerEntityType = (typeof WAIT_TIMER_ENTITY_TYPES)[number];

export const WAIT_FEE_STATUSES = [
  "none",
  "free",
  "accruing",
  "capped",
  "charged",
  "waived",
] as const;
export type WaitFeeStatus = (typeof WAIT_FEE_STATUSES)[number];

export const WAIT_TIMER_EVENT_TYPES = [
  "driver_arrived",
  "driver_arrival_blocked",
  "driver_arrival_manual_required",
  "wait_fee_started",
  "wait_fee_warning",
  "deposit_at_door",
  "taxi_no_show_cancel",
  "wait_fee_charged",
] as const;

export type WaitTimerComputed = {
  elapsed_seconds: number;
  elapsed_minutes: number;
  free_wait_minutes: number;
  billable_minutes: number;
  wait_fee_cents: number;
  wait_fee_dollars: number;
  wait_fee_status: WaitFeeStatus;
  max_fee_reached: boolean;
  can_charge_fees: boolean;
  can_deposit_at_door: boolean;
  can_cancel_no_penalty: boolean;
  remaining_free_seconds: number;
};

export type WaitTimerRow = {
  id: string;
  driver_arrived_at: string | null;
  wait_timer_started_at: string | null;
  free_wait_minutes: number | null;
  wait_fee_amount_cents: number | null;
  wait_fee_currency: string | null;
  wait_fee_minutes: number | null;
  wait_fee_status: string | null;
  proof_photo_url?: string | null;
  completion_reason: string | null;
  cancellation_exempt: boolean | null;
  cancellation_exempt_reason: string | null;
  driver_distance_to_target_meters: number | null;
  customer_no_show_validated: boolean | null;
  leave_at_door: boolean | null;
  manual_arrival_required: boolean | null;
  client_wait_arrived_notified_at: string | null;
  client_wait_fee_started_notified_at: string | null;
  client_wait_final_warning_notified_at: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  status?: string | null;
  driver_id?: string | null;
  currency?: string | null;
  driver_payout_cents?: number | null;
  total_cents?: number | null;
};
