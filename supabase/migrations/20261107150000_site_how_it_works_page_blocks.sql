-- Upgrade /how-it-works from a thin rich_text seed to a full CMS composition
-- using existing BlockRenderer types (hero, how_it_works, cta, faq).

begin;

do $$
declare
  pid uuid;
begin
  select id into pid
  from public.site_pages
  where locale = 'en' and slug = 'how-it-works';

  if pid is null then
    return;
  end if;

  update public.site_pages
  set
    title = 'How it works',
    seo = jsonb_build_object(
      'title', 'How it works — MMD Delivery',
      'description', 'From quote to delivery: estimate, pay securely with Stripe, create the job after payment confirmation, and track live until done.',
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
      'eyebrow', 'MMD Delivery',
      'headline', 'How it works',
      'subheadline', 'From quote to delivery — transparent pricing, pay-then-create integrity, and live tracking across taxi, food, packages, marketplace, and business.',
      'showcase', 'image',
      'image_url', '/brand/hero/hero-rider.webp',
      'benefits', jsonb_build_array(
        'Transparent quotes',
        'Pay then create',
        'Live GPS tracking'
      ),
      'primary_ctas', jsonb_build_array(
        jsonb_build_object('label', 'Download the app', 'href', '/download', 'event', 'store_click_web')
      ),
      'secondary_ctas', jsonb_build_array(
        jsonb_build_object('label', 'Contact us', 'href', '/contact', 'event', 'cta_contact')
      )
    )
  ),
  (
    pid, 'how_it_works', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Four steps. One reliable flow.',
      'steps', jsonb_build_array(
        jsonb_build_object(
          'title', 'Estimate',
          'body', 'Get a transparent quote before you pay.'
        ),
        jsonb_build_object(
          'title', 'Pay securely',
          'body', 'Stripe confirms payment — then we create the job.'
        ),
        jsonb_build_object(
          'title', 'Track live',
          'body', 'Follow dispatch, pickup, and delivery in real time.'
        ),
        jsonb_build_object(
          'title', 'Done',
          'body', 'Receipts, ratings, and support when you need them.'
        )
      )
    )
  ),
  (
    pid, 'rich_text', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'Pay-then-create integrity',
      'body_md', 'For card payments, MMD creates the ride or order only after Stripe confirms payment. That protects customers, drivers, restaurants, and sellers — and keeps operations production-grade rather than speculative.'
    )
  ),
  (
    pid, 'cta', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Ready to get started?',
      'body', 'Download the app or join as a driver, restaurant, seller, or business.',
      'buttons', jsonb_build_array(
        jsonb_build_object('label', 'Download the app', 'href', '/download', 'event', 'store_click_web'),
        jsonb_build_object('label', 'Contact us', 'href', '/contact', 'event', 'cta_contact')
      )
    )
  ),
  (
    pid, 'faq', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Frequently asked questions',
      'source', 'site_faq'
    )
  );
end $$;

commit;
