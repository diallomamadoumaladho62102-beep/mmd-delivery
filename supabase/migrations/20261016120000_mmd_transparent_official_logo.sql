-- Replace the cached white-background logo URL with the official transparent asset.
update public.site_settings
set
  payload = jsonb_set(
    payload,
    '{logo_url}',
    to_jsonb('/brand/mmd-logo-transparent-v2.png'::text),
    true
  ),
  updated_at = now()
where coalesce(payload ->> 'logo_url', '') in (
  '',
  '/brand/mmd-logo.png',
  '/brand/mmd-logo.webp'
);
