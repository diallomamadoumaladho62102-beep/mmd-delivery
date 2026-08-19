/**
 * Historical Taxi SCT closure — NOT a payment.
 *
 * legacy_closed / reconciled means the unpaid SCT inventory excludes the row
 * without inventing driver_transfer_id or setting driver_paid_out.
 */

export const TAXI_SCT_CLOSURE_LEGACY_CLOSED = "legacy_closed" as const;
export const TAXI_SCT_CLOSURE_RECONCILED = "reconciled" as const;

export type TaxiSctClosureStatus =
  | typeof TAXI_SCT_CLOSURE_LEGACY_CLOSED
  | typeof TAXI_SCT_CLOSURE_RECONCILED
  | null
  | undefined
  | string;

export function normalizeTaxiSctClosureStatus(
  value: TaxiSctClosureStatus,
): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** True when the commission is historically closed (no Stripe Transfer owed). */
export function isTaxiSctHistoricallyClosed(
  value: TaxiSctClosureStatus,
): boolean {
  const s = normalizeTaxiSctClosureStatus(value);
  return (
    s === TAXI_SCT_CLOSURE_LEGACY_CLOSED || s === TAXI_SCT_CLOSURE_RECONCILED
  );
}

/**
 * Counts toward unpaid SCT inventory / Wallet awaiting / platform payout guard
 * only when Transfer is missing AND not historically closed.
 */
export function taxiCommissionCountsAsUnpaidSct(params: {
  driverTransferId?: string | null;
  sctClosureStatus?: TaxiSctClosureStatus;
  driverCents?: number | null;
}): boolean {
  if (String(params.driverTransferId ?? "").trim()) return false;
  if (isTaxiSctHistoricallyClosed(params.sctClosureStatus)) return false;
  const cents = Math.round(Number(params.driverCents ?? 0));
  return Number.isFinite(cents) && cents > 0;
}
