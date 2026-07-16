-- Phase 7 follow-up: seller document URL list (no live money).
-- Logo/cover already exist; document_urls stores compliance/media links for admin review.

begin;

alter table public.sellers
  add column if not exists document_urls jsonb not null default '[]'::jsonb;

comment on column public.sellers.document_urls is
  'Seller compliance/media document URLs (JSON array of strings). Phase 7: URL-based upload references; no Stripe.';

commit;
