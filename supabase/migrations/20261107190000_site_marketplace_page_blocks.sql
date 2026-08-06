-- Upgrade /marketplace from a thin rich_text seed to a full CMS composition.

begin;

do $$
declare
  pid uuid;
begin
  select id into pid
  from public.site_pages
  where locale = 'en' and slug = 'marketplace';

  if pid is null then
    return;
  end if;

  update public.site_pages
  set
    title = 'Marketplace',
    seo = jsonb_build_object(
      'title', 'Marketplace — MMD Delivery',
      'description', 'Shop local sellers on MMD Marketplace. Browse products, checkout securely with Stripe, and get delivery with live tracking across Mauritius.',
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
      'eyebrow', 'Marketplace',
      'headline', 'Shop local with MMD',
      'headline_style', 'solid',
      'subheadline', 'Local sellers, secure checkout, and delivery built into the same production platform as taxi, food, and packages.',
      'showcase', 'image',
      'image_url', '/brand/services/marketplace.webp',
      'benefits', jsonb_build_array(
        'Local verified sellers',
        'Stripe-secured checkout',
        'Live delivery tracking'
      ),
      'primary_ctas', jsonb_build_array(
        jsonb_build_object('label', 'Download the app', 'href', '/download', 'event', 'cta_marketplace_download')
      ),
      'secondary_ctas', jsonb_build_array(
        jsonb_build_object('label', 'How it works', 'href', '/how-it-works', 'event', 'cta_how_it_works')
      )
    )
  ),
  (
    pid, 'features', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Why shop on MMD Marketplace',
      'items', jsonb_build_array(
        jsonb_build_object(
          'title', 'Local-first catalog',
          'description', 'Discover sellers near you with product pages built for clear pricing and availability.'
        ),
        jsonb_build_object(
          'title', 'Pay-then-create integrity',
          'description', 'Card checkouts create the order only after Stripe confirms payment — safer for buyers and sellers.'
        ),
        jsonb_build_object(
          'title', 'Delivery included',
          'description', 'Marketplace orders move through the same live dispatch and tracking stack as the rest of MMD.'
        ),
        jsonb_build_object(
          'title', 'Production-grade reliability',
          'description', 'Identity, payments, and fulfillment designed for day-to-day commerce — not prototypes.'
        )
      )
    )
  ),
  (
    pid, 'how_it_works', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'How Marketplace works',
      'anchor', 'start-marketplace',
      'steps', jsonb_build_array(
        jsonb_build_object('title', 'Browse local sellers', 'body', 'Discover products from verified sellers with clear pricing and availability.'),
        jsonb_build_object('title', 'Add to cart & checkout', 'body', 'Pay securely with Stripe — orders are created only after payment confirms.'),
        jsonb_build_object('title', 'Track your delivery', 'body', 'Follow pickup and drop-off with live status updates through to your door.'),
        jsonb_build_object('title', 'Sell on MMD', 'body', 'Publish your catalog, fulfill orders, and grow with production-grade marketplace ops.')
      )
    )
  ),
  (
    pid, 'rich_text', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Buy and sell with confidence',
      'body_md', 'MMD Marketplace connects local sellers with customers who expect secure payments and reliable delivery. Browse the catalog in the app, checkout with Stripe, and track every order.\n\n[Download the app](/download)'
    )
  ),
  (
    pid, 'cta', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Ready to shop local?',
      'body', 'Download MMD Delivery to browse sellers, checkout securely, and track marketplace deliveries.',
      'buttons', jsonb_build_array(
        jsonb_build_object('label', 'Download the app', 'href', '/download', 'event', 'cta_marketplace_download'),
        jsonb_build_object('label', 'How it works', 'href', '/how-it-works', 'event', 'cta_how_it_works')
      )
    )
  ),
  (
    pid, 'faq', 60, true, 'published', now(),
    jsonb_build_object(
      'title', 'Marketplace FAQ',
      'source', 'site_faq'
    )
  );
end $$;

commit;
