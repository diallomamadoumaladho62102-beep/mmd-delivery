-- Persist the user's chosen app locale for push / email / SMS copy.
-- Source of truth on device remains AsyncStorage; this column is the server copy.

alter table public.profiles
  add column if not exists preferred_locale text not null default 'en';

alter table public.user_push_tokens
  add column if not exists locale text not null default 'en';

do $locale_chk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_preferred_locale_chk'
  ) then
    alter table public.profiles
      add constraint profiles_preferred_locale_chk
      check (preferred_locale in ('en', 'fr', 'es', 'ar', 'zh', 'ff'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_push_tokens_locale_chk'
  ) then
    alter table public.user_push_tokens
      add constraint user_push_tokens_locale_chk
      check (locale in ('en', 'fr', 'es', 'ar', 'zh', 'ff'));
  end if;
end
$locale_chk$;

comment on column public.profiles.preferred_locale is
  'User-selected app locale (en/fr/es/ar/zh/ff). Used for email/SMS/push when no device token locale is present.';
comment on column public.user_push_tokens.locale is
  'Locale last registered by this device for localized Expo push copy.';
