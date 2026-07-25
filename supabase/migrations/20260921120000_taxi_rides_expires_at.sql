-- Expire unpaid / abandoned taxi rides the same way orders and delivery_requests do.
-- Drivers never see unpaid rides (dispatch is paid-gated); this stops DB/ops pollution.

ALTER TABLE public.taxi_rides
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

COMMENT ON COLUMN public.taxi_rides.expires_at IS
  'Payment window deadline. Unpaid/processing rides past expires_at + safety margin are canceled by expire-stale-payments.';

CREATE INDEX IF NOT EXISTS taxi_rides_unpaid_expires_at_idx
  ON public.taxi_rides (payment_status, status, expires_at)
  WHERE payment_status IN ('unpaid', 'processing')
    AND expires_at IS NOT NULL
    AND status IN ('draft', 'quoted', 'pending_payment', 'scheduled');

-- Backfill a short TTL for existing unpaid orphans so the next cron pass cleans them.
UPDATE public.taxi_rides
SET expires_at = COALESCE(updated_at, created_at, now()) + interval '30 minutes'
WHERE payment_status IN ('unpaid', 'processing')
  AND status IN ('draft', 'quoted', 'pending_payment', 'scheduled')
  AND expires_at IS NULL
  AND COALESCE(driver_id::text, '') = '';
