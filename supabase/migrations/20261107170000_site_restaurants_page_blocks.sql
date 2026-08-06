-- Upgrade /p/restaurants from a thin rich_text seed to a full CMS composition.

begin;

do $$
declare
  pid uuid;
begin
  select id into pid
  from public.site_pages
  where locale = 'en' and slug = 'restaurants';

  if pid is null then
    return;
  end if;

  update public.site_pages
  set
    title = 'Partner restaurants',
    seo = jsonb_build_object(
      'title', 'Partner restaurants — MMD Delivery',
      'description', 'Grow your restaurant with MMD Delivery. Publish menus, receive orders in real time, and get paid through Stripe Connect with production-grade ops.',
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
      'eyebrow', 'Restaurants',
      'headline', 'Partner with MMD',
      'headline_style', 'solid',
      'subheadline', 'Reach more customers with reliable food delivery — live order ops, clear payouts, and a restaurant experience built for production kitchens.',
      'showcase', 'image',
      'image_url', '/brand/services/food.webp',
      'benefits', jsonb_build_array(
        'Real-time order intake',
        'Stripe Connect payouts',
        'Kitchen-ready ops tools'
      ),
      'primary_ctas', jsonb_build_array(
        jsonb_build_object('label', 'Become a partner', 'href', '/signup/restaurant', 'event', 'cta_restaurant')
      ),
      'secondary_ctas', jsonb_build_array(
        jsonb_build_object('label', 'How it works', 'href', '/how-it-works', 'event', 'cta_how_it_works')
      )
    )
  ),
  (
    pid, 'features', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Why restaurants choose MMD',
      'items', jsonb_build_array(
        jsonb_build_object(
          'title', 'Orders that stay in sync',
          'description', 'Receive paid orders with clear statuses for prep, pickup, and delivery — not fragmented chat threads.'
        ),
        jsonb_build_object(
          'title', 'Transparent restaurant wallet',
          'description', 'Track sales and payouts clearly, then cash out through Stripe Connect when you are eligible.'
        ),
        jsonb_build_object(
          'title', 'Menu control that scales',
          'description', 'Publish items, modifiers, and availability windows so customers always see what you can fulfill.'
        ),
        jsonb_build_object(
          'title', 'Production-grade reliability',
          'description', 'Identity, dispatch, and payments designed for day-to-day restaurant operations — not prototypes.'
        )
      )
    )
  ),
  (
    pid, 'how_it_works', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'How to start partnering',
      'anchor', 'start-partnering',
      'steps', jsonb_build_array(
        jsonb_build_object('title', 'Create your restaurant', 'body', 'Sign up, add your location, hours, and brand details so customers can find you.'),
        jsonb_build_object('title', 'Publish your menu', 'body', 'Upload items, modifiers, and pricing with clear availability for every service window.'),
        jsonb_build_object('title', 'Go live for orders', 'body', 'Accept food delivery orders with live status updates for the kitchen and drivers.'),
        jsonb_build_object('title', 'Earn & get paid', 'body', 'Track sales in your restaurant wallet and cash out via Stripe Connect when eligible.')
      )
    )
  ),
  (
    pid, 'rich_text', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Operations you can trust',
      'body_md', 'Join MMD as a restaurant partner. Publish your menu, accept delivery orders, and track earnings in your wallet. Cash out via Stripe Connect when eligible.\n\n[Become a partner](/signup/restaurant)'
    )
  ),
  (
    pid, 'cta', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Ready to grow with MMD?',
      'body', 'Create your restaurant account and start accepting delivery orders when verification is complete.',
      'buttons', jsonb_build_array(
        jsonb_build_object('label', 'Become a partner', 'href', '/signup/restaurant', 'event', 'cta_restaurant'),
        jsonb_build_object('label', 'Contact support', 'href', '/contact', 'event', 'cta_contact')
      )
    )
  ),
  (
    pid, 'faq', 60, true, 'published', now(),
    jsonb_build_object(
      'title', 'Restaurant FAQ',
      'source', 'site_faq'
    )
  );
end $$;

commit;
