-- Upgrade /drivers from a thin rich_text seed to a full CMS composition.

begin;

do $$
declare
  pid uuid;
begin
  select id into pid
  from public.site_pages
  where locale = 'en' and slug = 'drivers';

  if pid is null then
    return;
  end if;

  update public.site_pages
  set
    title = 'Drive with MMD',
    seo = jsonb_build_object(
      'title', 'Drive with MMD — MMD Delivery',
      'description', 'Become a driver with MMD Delivery. Accept flexible missions across taxi, food, and packages. Track earnings and cash out via Stripe Connect when eligible.',
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
      'eyebrow', 'Drivers',
      'headline', 'Drive with MMD',
      'subheadline', 'Earn with flexible missions across taxi, food, and packages — secure payouts, live GPS, and a driver wallet built for production operations.',
      'showcase', 'image',
      'image_url', '/brand/services/taxi.webp',
      'benefits', jsonb_build_array(
        'Flexible multi-service missions',
        'Stripe Connect payouts',
        'Live GPS dispatch'
      ),
      'primary_ctas', jsonb_build_array(
        jsonb_build_object('label', 'Get started', 'href', '/signup/driver', 'event', 'cta_driver')
      ),
      'secondary_ctas', jsonb_build_array(
        jsonb_build_object('label', 'How it works', 'href', '/how-it-works', 'event', 'cta_how_it_works')
      )
    )
  ),
  (
    pid, 'features', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Why drive with MMD',
      'items', jsonb_build_array(
        jsonb_build_object(
          'title', 'Multi-service earnings',
          'description', 'Accept missions across taxi, food delivery, and packages from one driver experience.'
        ),
        jsonb_build_object(
          'title', 'Transparent wallet',
          'description', 'Track earnings clearly and cash out through Stripe Connect when you are eligible.'
        ),
        jsonb_build_object(
          'title', 'Live GPS tools',
          'description', 'Navigate jobs with real-time tracking for pickups, drops, and customer ETAs.'
        ),
        jsonb_build_object(
          'title', 'Production-grade ops',
          'description', 'Identity, dispatch, and payouts designed for reliable day-to-day driving — not prototypes.'
        )
      )
    )
  ),
  (
    pid, 'how_it_works', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'How to start driving',
      'anchor', 'start-driving',
      'steps', jsonb_build_array(
        jsonb_build_object('title', 'Sign up', 'body', 'Create your driver account and choose the services you want to offer.'),
        jsonb_build_object('title', 'Get verified', 'body', 'Complete identity and vehicle checks so you can go online safely.'),
        jsonb_build_object('title', 'Accept missions', 'body', 'Receive taxi, food, and package jobs with live GPS and clear payouts.'),
        jsonb_build_object('title', 'Earn & cash out', 'body', 'Track earnings in your wallet and cash out via Stripe Connect when eligible.')
      )
    )
  ),
  (
    pid, 'rich_text', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Payouts you can trust',
      'body_md', 'Join MMD as a driver. Accept missions across taxi, food, and packages. Track earnings in your wallet and cash out via Stripe Connect when eligible.\n\n[Get started](/signup/driver)'
    )
  ),
  (
    pid, 'cta', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Ready to earn with MMD?',
      'body', 'Create your driver account and start accepting missions when verification is complete.',
      'buttons', jsonb_build_array(
        jsonb_build_object('label', 'Become a driver', 'href', '/signup/driver', 'event', 'cta_driver'),
        jsonb_build_object('label', 'Contact support', 'href', '/contact', 'event', 'cta_contact')
      )
    )
  ),
  (
    pid, 'faq', 60, true, 'published', now(),
    jsonb_build_object(
      'title', 'Driver FAQ',
      'source', 'site_faq'
    )
  );
end $$;

commit;
