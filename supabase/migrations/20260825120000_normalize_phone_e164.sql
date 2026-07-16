-- Normalize profile and call_session phone numbers to E.164 (US +1)

begin;

update public.profiles
set phone = '+1' || phone
where phone is not null
  and phone <> ''
  and phone !~ '^\+'
  and phone ~ '^[0-9]{10}$';

update public.profiles
set phone = '+' || phone
where phone is not null
  and phone <> ''
  and phone !~ '^\+'
  and phone ~ '^1[0-9]{10}$';

update public.call_sessions
set caller_phone = '+1' || caller_phone
where caller_phone is not null
  and caller_phone <> ''
  and caller_phone !~ '^\+'
  and caller_phone ~ '^[0-9]{10}$';

update public.call_sessions
set target_phone = '+1' || target_phone
where target_phone is not null
  and target_phone <> ''
  and target_phone !~ '^\+'
  and target_phone ~ '^[0-9]{10}$';

update public.call_sessions
set caller_phone = '+' || caller_phone
where caller_phone is not null
  and caller_phone <> ''
  and caller_phone !~ '^\+'
  and caller_phone ~ '^1[0-9]{10}$';

update public.call_sessions
set target_phone = '+' || target_phone
where target_phone is not null
  and target_phone <> ''
  and target_phone !~ '^\+'
  and target_phone ~ '^1[0-9]{10}$';

commit;
