-- Phase 7.1 — marketing finalization SQL smoke expectations (manual / CI).
-- Not applied to Production by this file.

-- Expected RPCs (service_role):
--   mmd_marketing_credit_cashback(uuid, text)
--   mmd_marketing_credit_cashback_batch(integer)
--   mmd_marketing_clawback_cashback(uuid, text, text)
--   mmd_marketing_pay_driver_progress(uuid, text, text)
--   mmd_marketing_reverse_driver_progress(uuid, text, text)
--   mmd_marketing_process_driver_objectives_batch(integer)
--   mmd_marketing_bridge_taxi_promotions(boolean, integer)

-- Idempotency conventions (app layer):
--   marketing:food:<order_id>:reserve|capture|release|reverse
--   marketing:delivery:<request_id>:...
--   marketing:taxi:<ride_id>:...
--   marketing:marketplace:<order_id>:reverse:<refund_id>
--   marketing:cashback:<cashback_id>:credit|clawback
--   marketing:driver:<progress_id>:reward|reverse

-- Anti double-discount:
--   apply_taxi_promotion_to_ride refuses codes owned by marketing_promo_codes.

select 1;
