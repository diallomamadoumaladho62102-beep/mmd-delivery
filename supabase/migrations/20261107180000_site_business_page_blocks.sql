-- Upgrade /p/business from a thin rich_text seed to a full CMS composition.

begin;

do $$
declare
  pid uuid;
begin
  select id into pid
  from public.site_pages
  where locale = 'en' and slug = 'business';

  if pid is null then
    return;
  end if;

  update public.site_pages
  set
    title = 'Business',
    seo = jsonb_build_object(
      'title', 'Business — MMD Delivery',
      'description', 'Run corporate rides with MMD Delivery. Shared business wallets, team members, and approval workflows built for production operations.',
      'robots', 'index,follow'
    )
  where id = pid;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Business',
      'headline', 'Move your team with MMD',
      'headline_style', 'solid',
      'subheadline', 'Corporate wallets, member roles, and ride approvals — live GPS and production-grade spend control for every business trip.',
      'showcase', 'image',
      'image_url', '/brand/services/taxi.webp',
      'benefits', jsonb_build_array(
        'Shared business wallet',
        'Team roles & approvals',
        'Live ride tracking'
      ),
      'primary_ctas', jsonb_build_array(
        jsonb_build_object('label', 'Contact sales', 'href', '/contact', 'event', 'cta_business')
      ),
      'secondary_ctas', jsonb_build_array(
        jsonb_build_object('label', 'How it works', 'href', '/how-it-works', 'event', 'cta_how_it_works')
      )
    )
  ),
  (
    pid, 'features', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Why businesses choose MMD',
      'items', jsonb_build_array(
        jsonb_build_object(
          'title', 'Centralized wallet control',
          'description', 'Fund one business wallet and keep every approved ride on the company balance — not scattered personal cards.'
        ),
        jsonb_build_object(
          'title', 'Approvals that protect spend',
          'description', 'Members request rides; admins approve before dispatch so budgets stay intentional.'
        ),
        jsonb_build_object(
          'title', 'Roles for real teams',
          'description', 'Invite colleagues with clear permissions for requesting, approving, and reviewing activity.'
        ),
        jsonb_build_object(
          'title', 'Production-grade reliability',
          'description', 'Identity, dispatch, and payments designed for day-to-day corporate operations — not prototypes.'
        )
      )
    )
  ),
  (
    pid, 'how_it_works', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'How to start with Business',
      'anchor', 'start-business',
      'steps', jsonb_build_array(
        jsonb_build_object('title', 'Create your business account', 'body', 'Sign up, add your company profile, and set the basics for billing and support contacts.'),
        jsonb_build_object('title', 'Fund your business wallet', 'body', 'Top up the shared wallet so approved rides can be charged without personal cards.'),
        jsonb_build_object('title', 'Invite your team', 'body', 'Add members, set roles, and control who can request or approve corporate rides.'),
        jsonb_build_object('title', 'Approve & ride', 'body', 'Review pending requests, approve rides, and track live trips with clear spend reporting.')
      )
    )
  ),
  (
    pid, 'rich_text', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Operations built for companies',
      'body_md', 'Join MMD Business. Fund a shared wallet, invite your team, approve rides, and track every trip with live GPS. Built for production spend control.\n\n[Contact sales](/contact)'
    )
  ),
  (
    pid, 'cta', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Ready to move your team?',
      'body', 'Talk with our team to open a business wallet, invite members, and start approving corporate rides.',
      'buttons', jsonb_build_array(
        jsonb_build_object('label', 'Contact sales', 'href', '/contact', 'event', 'cta_business'),
        jsonb_build_object('label', 'How it works', 'href', '/how-it-works', 'event', 'cta_how_it_works')
      )
    )
  ),
  (
    pid, 'faq', 60, true, 'published', now(),
    jsonb_build_object(
      'title', 'Business FAQ',
      'source', 'site_faq'
    )
  );
end $$;

commit;
