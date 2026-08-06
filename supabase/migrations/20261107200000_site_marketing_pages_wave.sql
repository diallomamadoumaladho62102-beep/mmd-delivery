-- Upgrade remaining marketing pages to structured CMS compositions.

begin;

do $$
declare
  pid uuid;
begin

  -- faq
  select id into pid from public.site_pages where locale = 'en' and slug = 'faq';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      'faq',
      'FAQ',
      'published',
      jsonb_build_object(
        'title', 'FAQ — MMD Delivery',
        'description', 'Answers about MMD Delivery orders, payments, drivers, restaurants, business accounts, and support.',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = 'FAQ',
      seo = jsonb_build_object(
        'title', 'FAQ — MMD Delivery',
        'description', 'Answers about MMD Delivery orders, payments, drivers, restaurants, business accounts, and support.',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Help Center',
      'headline', 'Frequently asked questions',
      'headline_style', 'solid',
      'subheadline', 'Clear answers about payments, delivery, drivers, restaurants, and business accounts — built for production operations.',
      'showcase', 'image',
      'image_url', '/brand/services/taxi.webp',
      'benefits', jsonb_build_array('Pay-then-create clarity', 'Multi-service coverage', 'Human support'),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', 'Contact support', 'href', '/contact', 'event', 'cta_contact')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', 'How it works', 'href', '/how-it-works', 'event', 'cta_how_it_works'))
    )
  ),
  (
    pid, 'faq', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'FAQ',
      'source', 'site_faq'
    )
  ),
  (
    pid, 'cta', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'Still need help?',
      'body', 'Reach our support team and we will help you resolve account, order, or payout questions.',
      'buttons', jsonb_build_array(jsonb_build_object('label', 'Contact support', 'href', '/contact', 'event', 'cta_contact'), jsonb_build_object('label', 'Download the app', 'href', '/download', 'event', 'cta_download'))
    )
  );


  -- contact
  select id into pid from public.site_pages where locale = 'en' and slug = 'contact';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      'contact',
      'Contact',
      'published',
      jsonb_build_object(
        'title', 'Contact — MMD Delivery',
        'description', 'Contact MMD Delivery support for orders, partnerships, business accounts, and press inquiries.',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = 'Contact',
      seo = jsonb_build_object(
        'title', 'Contact — MMD Delivery',
        'description', 'Contact MMD Delivery support for orders, partnerships, business accounts, and press inquiries.',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Contact',
      'headline', 'We''re here to help',
      'headline_style', 'solid',
      'subheadline', 'Message our team for customer support, restaurant or driver onboarding, business accounts, and partnership requests.',
      'showcase', 'image',
      'image_url', '/brand/services/package.webp',
      'benefits', jsonb_build_array('support@mmddelivery.com', 'Partnerships & press', 'Business onboarding'),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', 'Send a message', 'href', '/contact#contact-form', 'event', 'cta_contact_form')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', 'FAQ', 'href', '/faq', 'event', 'cta_faq'))
    )
  ),
  (
    pid, 'contact', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Send a message',
      'anchor', 'contact-form'
    )
  ),
  (
    pid, 'rich_text', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'How to reach us',
      'body_md', 'Use the form on this page for the fastest response. You can also email support@mmddelivery.com for account and delivery questions.

[Browse FAQ](/faq)'
    )
  ),
  (
    pid, 'cta', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Prefer the app?',
      'body', 'Download MMD Delivery for live order tracking and in-app support tools.',
      'buttons', jsonb_build_array(jsonb_build_object('label', 'Download the app', 'href', '/download', 'event', 'cta_download'), jsonb_build_object('label', 'How it works', 'href', '/how-it-works', 'event', 'cta_how_it_works'))
    )
  ),
  (
    pid, 'faq', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Quick answers',
      'source', 'site_faq'
    )
  );


  -- company
  select id into pid from public.site_pages where locale = 'en' and slug = 'company';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      'company',
      'Company',
      'published',
      jsonb_build_object(
        'title', 'Company — MMD Delivery',
        'description', 'Learn about MMD Delivery — modern multi-service infrastructure for taxi, food, packages, marketplace, and business logistics.',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = 'Company',
      seo = jsonb_build_object(
        'title', 'Company — MMD Delivery',
        'description', 'Learn about MMD Delivery — modern multi-service infrastructure for taxi, food, packages, marketplace, and business logistics.',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Company',
      'headline', 'We Deliver With Heart',
      'headline_style', 'solid',
      'subheadline', 'MMD Delivery builds production-grade logistics for customers, drivers, restaurants, sellers, and businesses — with live GPS and Stripe-secured payments.',
      'showcase', 'image',
      'image_url', '/brand/hero/hero-rider.webp',
      'benefits', jsonb_build_array('Multi-service platform', 'Live GPS dispatch', 'Stripe-secured payments'),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', 'Contact us', 'href', '/contact', 'event', 'cta_contact')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', 'Careers', 'href', '/careers', 'event', 'cta_careers'))
    )
  ),
  (
    pid, 'features', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'What we stand for',
      'items', jsonb_build_array(
        jsonb_build_object('title', 'Customer trust', 'description', 'Pay-then-create integrity and live tracking so every trip and order stays transparent.'),
        jsonb_build_object('title', 'Partner success', 'description', 'Tools for drivers, restaurants, and sellers that match real day-to-day operations.'),
        jsonb_build_object('title', 'Business control', 'description', 'Corporate wallets, approvals, and reporting for teams that need spend discipline.'),
        jsonb_build_object('title', 'Production reliability', 'description', 'Identity, dispatch, and payments designed for scale — not prototypes.')
      )
    )
  ),
  (
    pid, 'how_it_works', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'How we work with you',
      'anchor', 'company-path',
      'steps', jsonb_build_array(
        jsonb_build_object('title', 'Discover the platform', 'body', 'Explore taxi, food, packages, marketplace, and business services in one product family.'),
        jsonb_build_object('title', 'Choose your role', 'body', 'Join as a customer, driver, restaurant, seller, or business team.'),
        jsonb_build_object('title', 'Operate with clarity', 'body', 'Track jobs, payouts, and approvals with production-grade status flows.'),
        jsonb_build_object('title', 'Grow with support', 'body', 'Use Help Center, FAQ, and human support when you need a hand.')
      )
    )
  ),
  (
    pid, 'rich_text', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'About MMD Delivery',
      'body_md', 'MMD Delivery is a multi-service platform focused on reliable local logistics. We combine live GPS, Stripe payments, and role-based tools so every participant can operate with confidence.

[Contact the team](/contact)'
    )
  ),
  (
    pid, 'cta', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Build with us',
      'body', 'Whether you are hiring, partnering, or launching a business account — start a conversation.',
      'buttons', jsonb_build_array(jsonb_build_object('label', 'Contact us', 'href', '/contact', 'event', 'cta_contact'), jsonb_build_object('label', 'View careers', 'href', '/careers', 'event', 'cta_careers'))
    )
  ),
  (
    pid, 'faq', 60, true, 'published', now(),
    jsonb_build_object(
      'title', 'Company FAQ',
      'source', 'site_faq'
    )
  );


  -- careers
  select id into pid from public.site_pages where locale = 'en' and slug = 'careers';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      'careers',
      'Careers',
      'published',
      jsonb_build_object(
        'title', 'Careers — MMD Delivery',
        'description', 'Join MMD Delivery. Explore roles across product, operations, support, and growth for a multi-service logistics platform.',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = 'Careers',
      seo = jsonb_build_object(
        'title', 'Careers — MMD Delivery',
        'description', 'Join MMD Delivery. Explore roles across product, operations, support, and growth for a multi-service logistics platform.',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Careers',
      'headline', 'Build the future of local delivery',
      'headline_style', 'solid',
      'subheadline', 'Help us ship reliable taxi, food, package, marketplace, and business logistics used in production every day.',
      'showcase', 'image',
      'image_url', '/brand/services/package.webp',
      'benefits', jsonb_build_array('Product & engineering', 'Operations & support', 'Growth roles'),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', 'Contact talent team', 'href', '/contact', 'event', 'cta_careers_contact')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', 'About the company', 'href', '/company', 'event', 'cta_company'))
    )
  ),
  (
    pid, 'features', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Why work at MMD',
      'items', jsonb_build_array(
        jsonb_build_object('title', 'Real production systems', 'description', 'Ship features that move people, food, and packages — with payments and dispatch that must work.'),
        jsonb_build_object('title', 'Multi-sided platform', 'description', 'Collaborate across customer, driver, restaurant, seller, and business experiences.'),
        jsonb_build_object('title', 'Ownership culture', 'description', 'Small teams, clear accountability, and high bars for reliability.'),
        jsonb_build_object('title', 'Customer empathy', 'description', 'We design for the stressful moments — late nights, peak hours, and live support.')
      )
    )
  ),
  (
    pid, 'how_it_works', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'How to apply',
      'anchor', 'apply',
      'steps', jsonb_build_array(
        jsonb_build_object('title', 'Review open themes', 'body', 'Tell us which domain fits you — product, ops, support, partnerships, or growth.'),
        jsonb_build_object('title', 'Send your profile', 'body', 'Contact our talent team with your CV and the problems you want to own.'),
        jsonb_build_object('title', 'Conversation', 'body', 'We discuss experience, craft, and how you operate under production constraints.'),
        jsonb_build_object('title', 'Join the build', 'body', 'Onboard with clear goals and ship alongside the core platform team.')
      )
    )
  ),
  (
    pid, 'rich_text', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Open conversations',
      'body_md', 'We hire for impact across engineering, design, operations, and partner success. Even if a role is not listed, send a strong note.

[Contact talent](/contact)'
    )
  ),
  (
    pid, 'cta', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Ready to apply?',
      'body', 'Reach out and tell us how you want to strengthen MMD Delivery.',
      'buttons', jsonb_build_array(jsonb_build_object('label', 'Contact talent team', 'href', '/contact', 'event', 'cta_careers_contact'), jsonb_build_object('label', 'Company overview', 'href', '/company', 'event', 'cta_company'))
    )
  ),
  (
    pid, 'faq', 60, true, 'published', now(),
    jsonb_build_object(
      'title', 'Careers FAQ',
      'source', 'site_faq'
    )
  );


  -- partners
  select id into pid from public.site_pages where locale = 'en' and slug = 'partners';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      'partners',
      'Partners',
      'published',
      jsonb_build_object(
        'title', 'Partners — MMD Delivery',
        'description', 'Partner with MMD Delivery as a restaurant, driver network, seller, or business logistics collaborator.',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = 'Partners',
      seo = jsonb_build_object(
        'title', 'Partners — MMD Delivery',
        'description', 'Partner with MMD Delivery as a restaurant, driver network, seller, or business logistics collaborator.',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Partners',
      'headline', 'Grow with MMD Delivery',
      'headline_style', 'solid',
      'subheadline', 'Collaborate as a restaurant, driver fleet, marketplace seller, or strategic partner on a production multi-service platform.',
      'showcase', 'image',
      'image_url', '/brand/services/food.webp',
      'benefits', jsonb_build_array('Restaurant partners', 'Driver networks', 'Marketplace sellers'),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', 'Become a partner', 'href', '/contact', 'event', 'cta_partners')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', 'Restaurant signup', 'href', '/signup/restaurant', 'event', 'cta_restaurant'))
    )
  ),
  (
    pid, 'features', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Partnership tracks',
      'items', jsonb_build_array(
        jsonb_build_object('title', 'Restaurants', 'description', 'Publish menus, accept delivery orders, and cash out through Stripe Connect when eligible.'),
        jsonb_build_object('title', 'Drivers', 'description', 'Multi-service missions with live GPS and transparent wallet tooling.'),
        jsonb_build_object('title', 'Marketplace sellers', 'description', 'List products with secure checkout and delivery built into MMD.'),
        jsonb_build_object('title', 'Strategic partners', 'description', 'Integrate logistics capacity, promotions, or local distribution programs.')
      )
    )
  ),
  (
    pid, 'how_it_works', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'How partnering works',
      'anchor', 'partner-path',
      'steps', jsonb_build_array(
        jsonb_build_object('title', 'Tell us your model', 'body', 'Share whether you are a restaurant, fleet, seller, or strategic collaborator.'),
        jsonb_build_object('title', 'Align on operations', 'body', 'We map onboarding, SLAs, and the tools your team will use daily.'),
        jsonb_build_object('title', 'Go live', 'body', 'Launch with production payments, dispatch, and support coverage.'),
        jsonb_build_object('title', 'Optimize together', 'body', 'Review performance and expand services as volume grows.')
      )
    )
  ),
  (
    pid, 'rich_text', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Partner with confidence',
      'body_md', 'MMD partners operate on the same infrastructure customers already trust for taxi, food, packages, and marketplace delivery.

[Start the conversation](/contact)'
    )
  ),
  (
    pid, 'cta', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Let''s partner',
      'body', 'Contact our partnerships team to explore the right track for your business.',
      'buttons', jsonb_build_array(jsonb_build_object('label', 'Contact partnerships', 'href', '/contact', 'event', 'cta_partners'), jsonb_build_object('label', 'Driver signup', 'href', '/signup/driver', 'event', 'cta_driver'))
    )
  ),
  (
    pid, 'faq', 60, true, 'published', now(),
    jsonb_build_object(
      'title', 'Partners FAQ',
      'source', 'site_faq'
    )
  );


  -- press
  select id into pid from public.site_pages where locale = 'en' and slug = 'press';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      'press',
      'Press',
      'published',
      jsonb_build_object(
        'title', 'Press — MMD Delivery',
        'description', 'Press and media resources for MMD Delivery — brand assets, company facts, and media contact.',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = 'Press',
      seo = jsonb_build_object(
        'title', 'Press — MMD Delivery',
        'description', 'Press and media resources for MMD Delivery — brand assets, company facts, and media contact.',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Press',
      'headline', 'Media & brand resources',
      'headline_style', 'solid',
      'subheadline', 'Get the facts, brand assets, and the right contact for stories about MMD Delivery.',
      'showcase', 'image',
      'image_url', '/brand/og-transparent-v2.png',
      'benefits', jsonb_build_array('Brand assets', 'Company facts', 'Media contact'),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', 'Contact press', 'href', '/contact', 'event', 'cta_press')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', 'Company overview', 'href', '/company', 'event', 'cta_company'))
    )
  ),
  (
    pid, 'features', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'For journalists',
      'items', jsonb_build_array(
        jsonb_build_object('title', 'Accurate positioning', 'description', 'MMD Delivery is a multi-service logistics platform spanning taxi, food, packages, marketplace, and business.'),
        jsonb_build_object('title', 'Production focus', 'description', 'Our product emphasizes pay-then-create integrity, live GPS, and operational reliability.'),
        jsonb_build_object('title', 'Brand kit', 'description', 'Use official logos and brand imagery from our public brand assets.'),
        jsonb_build_object('title', 'Direct contact', 'description', 'Reach the team through the contact form for interviews and fact checks.')
      )
    )
  ),
  (
    pid, 'rich_text', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'Press contact',
      'body_md', 'For media inquiries, email support@mmddelivery.com with subject line Press and your deadline.

[Contact form](/contact)'
    )
  ),
  (
    pid, 'cta', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Need a quote or asset?',
      'body', 'Send your request and timeline — we will respond as quickly as possible.',
      'buttons', jsonb_build_array(jsonb_build_object('label', 'Contact press', 'href', '/contact', 'event', 'cta_press'), jsonb_build_object('label', 'Download brand logo', 'href', '/brand/mmd-logo-transparent-v2.png', 'event', 'cta_brand'))
    )
  ),
  (
    pid, 'faq', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Press FAQ',
      'source', 'site_faq'
    )
  );


  -- download
  select id into pid from public.site_pages where locale = 'en' and slug = 'download';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      'download',
      'Download',
      'published',
      jsonb_build_object(
        'title', 'Download — MMD Delivery',
        'description', 'Download MMD Delivery for iOS and Android. Access taxi, food, packages, marketplace, and business tools in one app.',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = 'Download',
      seo = jsonb_build_object(
        'title', 'Download — MMD Delivery',
        'description', 'Download MMD Delivery for iOS and Android. Access taxi, food, packages, marketplace, and business tools in one app.',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Download',
      'headline', 'Get MMD Delivery',
      'headline_style', 'solid',
      'subheadline', 'One app for taxi, food delivery, packages, marketplace shopping, and business logistics — with live tracking and secure payments.',
      'showcase', 'image',
      'image_url', '/brand/mmd-logo-transparent-v2.png',
      'benefits', jsonb_build_array('iOS & Android', 'Live GPS tracking', 'Secure Stripe checkout'),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', 'Download on the App Store', 'href', '/download#ios', 'event', 'cta_ios')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', 'Get it on Google Play', 'href', '/download#android', 'event', 'cta_android'))
    )
  ),
  (
    pid, 'features', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'What you get in the app',
      'items', jsonb_build_array(
        jsonb_build_object('title', 'Taxi', 'description', 'Quote, pay, ride, and track with production-grade dispatch.'),
        jsonb_build_object('title', 'Food', 'description', 'Order from partner restaurants with kitchen-ready status flows.'),
        jsonb_build_object('title', 'Packages', 'description', 'Send and receive with pickup codes and live ETAs.'),
        jsonb_build_object('title', 'Marketplace & Business', 'description', 'Shop local sellers or run corporate rides with approvals.')
      )
    )
  ),
  (
    pid, 'how_it_works', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'How to get started',
      'anchor', 'install',
      'steps', jsonb_build_array(
        jsonb_build_object('title', 'Download the app', 'body', 'Install MMD Delivery from the App Store or Google Play when available in your region.'),
        jsonb_build_object('title', 'Create your account', 'body', 'Sign up as a customer — or continue partner onboarding for drivers and restaurants on the web.'),
        jsonb_build_object('title', 'Choose a service', 'body', 'Book a taxi, order food, send a package, or shop the marketplace.'),
        jsonb_build_object('title', 'Track live', 'body', 'Follow status updates from payment through delivery.')
      )
    )
  ),
  (
    pid, 'rich_text', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Store links',
      'body_md', 'Store buttons on this page use the official configured App Store and Play Store URLs when set, and otherwise keep you on mmddelivery.com/download.

[Contact support](/contact)'
    )
  ),
  (
    pid, 'cta', 50, true, 'published', now(),
    jsonb_build_object(
      'title', 'Need the website instead?',
      'body', 'You can still explore services, partner signups, and support from the marketing site.',
      'buttons', jsonb_build_array(jsonb_build_object('label', 'Back to home', 'href', '/', 'event', 'cta_home'), jsonb_build_object('label', 'Contact support', 'href', '/contact', 'event', 'cta_contact'))
    )
  ),
  (
    pid, 'faq', 60, true, 'published', now(),
    jsonb_build_object(
      'title', 'Download FAQ',
      'source', 'site_faq'
    )
  );


  -- privacy
  select id into pid from public.site_pages where locale = 'en' and slug = 'privacy';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      'privacy',
      'Privacy Policy',
      'published',
      jsonb_build_object(
        'title', 'Privacy Policy — MMD Delivery',
        'description', 'How MMD Delivery collects, stores, and processes account, order, location, and payment data.',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = 'Privacy Policy',
      seo = jsonb_build_object(
        'title', 'Privacy Policy — MMD Delivery',
        'description', 'How MMD Delivery collects, stores, and processes account, order, location, and payment data.',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Legal',
      'headline', 'Privacy Policy',
      'headline_style', 'solid',
      'subheadline', 'How we handle account information, delivery data, location during active jobs, and payment processing.',
      'showcase', 'image',
      'image_url', '/brand/og-transparent-v2.png',
      'benefits', jsonb_build_array('Supabase storage', 'Stripe payments', 'Access & deletion requests'),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', 'Contact privacy', 'href', '/contact', 'event', 'cta_privacy')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', 'Terms of Service', 'href', '/legal/terms', 'event', 'cta_terms'))
    )
  ),
  (
    pid, 'rich_text', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Privacy Policy',
      'body_md', 'MMD Delivery collects account information, order and delivery data, location during active deliveries, and photos uploaded as proof. Data is stored on Supabase and processed by Stripe for payments.

For data access or deletion requests, contact support@mmddelivery.com or use the [contact form](/contact).

We update this policy as the platform evolves. Continued use of MMD Delivery means you acknowledge the latest published version.'
    )
  ),
  (
    pid, 'cta', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'Questions about privacy?',
      'body', 'Contact support for access, deletion, or clarification requests.',
      'buttons', jsonb_build_array(jsonb_build_object('label', 'Contact support', 'href', '/contact', 'event', 'cta_contact'), jsonb_build_object('label', 'Support page', 'href', '/legal/support', 'event', 'cta_support'))
    )
  );


  -- terms
  select id into pid from public.site_pages where locale = 'en' and slug = 'terms';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      'terms',
      'Terms of Service',
      'published',
      jsonb_build_object(
        'title', 'Terms of Service — MMD Delivery',
        'description', 'Terms governing use of MMD Delivery services for customers, drivers, restaurants, sellers, and businesses.',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = 'Terms of Service',
      seo = jsonb_build_object(
        'title', 'Terms of Service — MMD Delivery',
        'description', 'Terms governing use of MMD Delivery services for customers, drivers, restaurants, sellers, and businesses.',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Legal',
      'headline', 'Terms of Service',
      'headline_style', 'solid',
      'subheadline', 'The rules for using MMD Delivery across taxi, food, packages, marketplace, and business services.',
      'showcase', 'image',
      'image_url', '/brand/og-transparent-v2.png',
      'benefits', jsonb_build_array('Service rules', 'Payments & refunds', 'Acceptable use'),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', 'Contact support', 'href', '/contact', 'event', 'cta_contact')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', 'Privacy Policy', 'href', '/legal/privacy', 'event', 'cta_privacy'))
    )
  ),
  (
    pid, 'rich_text', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Terms of Service',
      'body_md', 'By using MMD Delivery you agree to follow applicable laws, provide accurate account information, and use the platform only for legitimate transportation, delivery, marketplace, and business logistics purposes.

Payments are processed by Stripe. Orders and rides paid by card are created only after payment confirmation. Refunds and disputes follow Stripe and platform policies for the relevant service.

We may suspend accounts that abuse drivers, restaurants, customers, or platform systems. For questions, contact support@mmddelivery.com or use the [contact form](/contact).'
    )
  ),
  (
    pid, 'cta', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'Need clarification?',
      'body', 'Our support team can help explain how these terms apply to your account.',
      'buttons', jsonb_build_array(jsonb_build_object('label', 'Contact support', 'href', '/contact', 'event', 'cta_contact'), jsonb_build_object('label', 'FAQ', 'href', '/faq', 'event', 'cta_faq'))
    )
  );


  -- support
  select id into pid from public.site_pages where locale = 'en' and slug = 'support';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      'support',
      'Support',
      'published',
      jsonb_build_object(
        'title', 'Support — MMD Delivery',
        'description', 'Get help with MMD Delivery accounts, orders, payouts, and partner onboarding.',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = 'Support',
      seo = jsonb_build_object(
        'title', 'Support — MMD Delivery',
        'description', 'Get help with MMD Delivery accounts, orders, payouts, and partner onboarding.',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  (
    pid, 'hero', 10, true, 'published', now(),
    jsonb_build_object(
      'eyebrow', 'Support',
      'headline', 'Help when you need it',
      'headline_style', 'solid',
      'subheadline', 'Find answers fast in the FAQ, or contact the team for account, order, and payout support.',
      'showcase', 'image',
      'image_url', '/brand/services/taxi.webp',
      'benefits', jsonb_build_array('FAQ self-serve', 'Email support', 'Partner onboarding help'),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', 'Contact support', 'href', '/contact', 'event', 'cta_contact')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', 'Browse FAQ', 'href', '/faq', 'event', 'cta_faq'))
    )
  ),
  (
    pid, 'rich_text', 20, true, 'published', now(),
    jsonb_build_object(
      'title', 'Support channels',
      'body_md', 'Start with the FAQ for common questions about payments, delivery timing, drivers, and business accounts.

Email support@mmddelivery.com or use the [contact form](/contact). Include your order or ride reference when possible.

Website: https://www.mmddelivery.com'
    )
  ),
  (
    pid, 'cta', 30, true, 'published', now(),
    jsonb_build_object(
      'title', 'Talk to a human',
      'body', 'Send a message and our team will help you resolve the issue.',
      'buttons', jsonb_build_array(jsonb_build_object('label', 'Contact support', 'href', '/contact', 'event', 'cta_contact'), jsonb_build_object('label', 'Download the app', 'href', '/download', 'event', 'cta_download'))
    )
  ),
  (
    pid, 'faq', 40, true, 'published', now(),
    jsonb_build_object(
      'title', 'Support FAQ',
      'source', 'site_faq'
    )
  );

end $$;

commit;
