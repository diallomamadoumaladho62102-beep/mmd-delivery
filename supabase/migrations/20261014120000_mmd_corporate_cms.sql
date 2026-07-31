-- Corporate CMS for www.mmddelivery.com
-- Locale-ready (seed en). Public reads published only via service APIs.

begin;

-- ---------------------------------------------------------------------------
-- Settings (one row per locale)
-- ---------------------------------------------------------------------------
create table if not exists public.site_settings (
  locale text not null default 'en' primary key
    check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Menus
-- ---------------------------------------------------------------------------
create table if not exists public.site_menus (
  id uuid primary key default gen_random_uuid(),
  locale text not null default 'en',
  key text not null,
  label text not null default '',
  created_at timestamptz not null default now(),
  unique (locale, key)
);

create table if not exists public.site_menu_items (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.site_menus (id) on delete cascade,
  parent_id uuid references public.site_menu_items (id) on delete cascade,
  label text not null,
  href text not null,
  target text not null default '_self',
  sort_order integer not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists site_menu_items_menu_sort_idx
  on public.site_menu_items (menu_id, sort_order);

-- ---------------------------------------------------------------------------
-- Pages + blocks
-- ---------------------------------------------------------------------------
create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  locale text not null default 'en',
  slug text not null,
  title text not null,
  kind text not null default 'marketing'
    check (kind in ('marketing','campaign','landing','event','promotion','docs','help','home')),
  template text not null default 'standard',
  status text not null default 'draft'
    check (status in ('draft','scheduled','published','archived')),
  published_at timestamptz,
  scheduled_for timestamptz,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (locale, slug)
);

create index if not exists site_pages_status_idx
  on public.site_pages (locale, status, published_at desc);

create table if not exists public.site_page_blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.site_pages (id) on delete cascade,
  block_type text not null,
  sort_order integer not null default 0,
  visible boolean not null default true,
  status text not null default 'published'
    check (status in ('draft','scheduled','published','archived')),
  published_at timestamptz,
  scheduled_for timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_page_blocks_page_sort_idx
  on public.site_page_blocks (page_id, sort_order);

-- ---------------------------------------------------------------------------
-- Overlays (banners / popups / announcements)
-- ---------------------------------------------------------------------------
create table if not exists public.site_overlays (
  id uuid primary key default gen_random_uuid(),
  locale text not null default 'en',
  kind text not null default 'banner'
    check (kind in ('banner','popup','announcement','promo')),
  title text,
  body text,
  cta_label text,
  cta_href text,
  placement text not null default 'top',
  dismissible boolean not null default true,
  sort_order integer not null default 0,
  status text not null default 'draft'
    check (status in ('draft','scheduled','published','archived')),
  published_at timestamptz,
  scheduled_for timestamptz,
  expires_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Posts (blog / press / careers / news)
-- ---------------------------------------------------------------------------
create table if not exists public.site_posts (
  id uuid primary key default gen_random_uuid(),
  locale text not null default 'en',
  post_type text not null default 'blog'
    check (post_type in ('blog','news','press','careers','announcement')),
  slug text not null,
  title text not null,
  excerpt text,
  body_md text not null default '',
  cover_media_id uuid,
  author_name text,
  categories text[] not null default '{}',
  tags text[] not null default '{}',
  related_post_ids uuid[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft','scheduled','published','archived')),
  published_at timestamptz,
  scheduled_for timestamptz,
  seo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (locale, post_type, slug)
);

create index if not exists site_posts_published_idx
  on public.site_posts (locale, post_type, status, published_at desc);

-- ---------------------------------------------------------------------------
-- FAQ / partners
-- ---------------------------------------------------------------------------
create table if not exists public.site_faq_items (
  id uuid primary key default gen_random_uuid(),
  locale text not null default 'en',
  category text not null default 'general',
  question text not null,
  answer_md text not null,
  sort_order integer not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_partners (
  id uuid primary key default gen_random_uuid(),
  locale text not null default 'en',
  name text not null,
  url text,
  logo_media_id uuid,
  sort_order integer not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Media library
-- ---------------------------------------------------------------------------
create table if not exists public.site_media (
  id uuid primary key default gen_random_uuid(),
  folder text not null default 'general',
  filename text not null,
  storage_path text not null unique,
  thumb_path text,
  optimized_path text,
  alt text,
  mime text,
  width integer,
  height integer,
  bytes integer,
  tags text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  replaced_at timestamptz
);

create index if not exists site_media_folder_idx on public.site_media (folder, created_at desc);

alter table public.site_posts
  drop constraint if exists site_posts_cover_media_id_fkey;
alter table public.site_posts
  add constraint site_posts_cover_media_id_fkey
  foreign key (cover_media_id) references public.site_media (id) on delete set null;

alter table public.site_partners
  drop constraint if exists site_partners_logo_media_id_fkey;
alter table public.site_partners
  add constraint site_partners_logo_media_id_fkey
  foreign key (logo_media_id) references public.site_media (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Revisions / contact / newsletter / analytics
-- ---------------------------------------------------------------------------
create table if not exists public.site_revisions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  locale text,
  snapshot jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists site_revisions_entity_idx
  on public.site_revisions (entity_type, entity_id, created_at desc);

create table if not exists public.site_contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  subject text,
  message text not null,
  status text not null default 'new'
    check (status in ('new','in_progress','done')),
  assignee_user_id uuid references auth.users (id) on delete set null,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_contact_status_idx
  on public.site_contact_submissions (status, created_at desc);

create table if not exists public.site_newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  locale text not null default 'en',
  source text not null default 'website',
  status text not null default 'active'
    check (status in ('active','unsubscribed')),
  created_at timestamptz not null default now(),
  unique (email)
);

create table if not exists public.site_analytics_events (
  id bigserial primary key,
  event_name text not null,
  path text,
  meta jsonb not null default '{}'::jsonb,
  session_id text,
  created_at timestamptz not null default now()
);

create index if not exists site_analytics_events_name_time_idx
  on public.site_analytics_events (event_name, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS deny-all (service_role / admin APIs only)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'site_settings','site_menus','site_menu_items','site_pages','site_page_blocks',
    'site_overlays','site_posts','site_faq_items','site_partners','site_media',
    'site_revisions','site_contact_submissions','site_newsletter_subscribers',
    'site_analytics_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_deny_all', t);
    execute format(
      'create policy %I on public.%I for all using (false) with check (false)',
      t || '_deny_all', t
    );
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
  grant usage, select on sequence public.site_analytics_events_id_seq to service_role;
end $$;

-- Storage bucket (idempotent)
insert into storage.buckets (id, name, public)
values ('site-media', 'site-media', true)
on conflict (id) do update set public = excluded.public;

-- ---------------------------------------------------------------------------
-- Seed EN
-- ---------------------------------------------------------------------------
insert into public.site_settings (locale, payload)
values (
  'en',
  jsonb_build_object(
    'brand_name', 'MMD Delivery',
    'slogan', 'We Deliver With Heart',
    'tagline', 'Taxi, food, packages, marketplace and business tools — one modern platform.',
    'support_email', 'support@mmddelivery.com',
    'support_phone', '+1 (929) 492-4563',
    'support_phone_tel', '+19294924563',
    'address', 'United States',
    'logo_url', '/brand/mmd-logo.png',
    'hero_image_url', '/brand/hero/hero-rider.png',
    'store_links', jsonb_build_object(
      'ios', 'https://www.mmddelivery.com/download',
      'android', 'https://www.mmddelivery.com/download',
      'web_app', 'https://www.mmddelivery.com/download'
    ),
    'cta_links', jsonb_build_object(
      'driver', '/drivers',
      'restaurant', '/p/restaurants',
      'marketplace', '/marketplace',
      'business', '/p/business'
    ),
    'socials', jsonb_build_object(
      'facebook', '',
      'instagram', '',
      'x', '',
      'linkedin', '',
      'youtube', ''
    ),
    'seo', jsonb_build_object(
      'title', 'MMD Delivery — We Deliver With Heart',
      'description', 'Order food, book taxi rides, send packages, shop the marketplace, and run business deliveries with MMD Delivery.',
      'robots', 'index,follow'
    ),
    'footer_blurb', 'Modern delivery infrastructure for clients, drivers, restaurants, sellers, and businesses.'
  )
)
on conflict (locale) do nothing;

insert into public.site_menus (locale, key, label)
values ('en', 'header', 'Header'), ('en', 'footer', 'Footer')
on conflict (locale, key) do nothing;

insert into public.site_menu_items (menu_id, label, href, sort_order)
select m.id, x.label, x.href, x.sort_order
from public.site_menus m
cross join (
  values
    ('Services', '/#services', 10),
    ('Company', '/company', 20),
    ('Drivers', '/drivers', 30),
    ('Restaurants', '/restaurants', 40),
    ('Business', '/business', 50),
    ('Blog', '/blog', 60),
    ('Contact', '/contact', 70)
) as x(label, href, sort_order)
where m.locale = 'en' and m.key = 'header'
  and not exists (select 1 from public.site_menu_items i where i.menu_id = m.id);

insert into public.site_menu_items (menu_id, label, href, sort_order)
select m.id, x.label, x.href, x.sort_order
from public.site_menus m
cross join (
  values
    ('Help Center', '/legal/support', 10),
    ('Privacy', '/legal/privacy', 20),
    ('Terms', '/legal/terms', 30),
    ('Download', '/download', 40),
    ('Contact', '/contact', 50)
) as x(label, href, sort_order)
where m.locale = 'en' and m.key = 'footer'
  and not exists (select 1 from public.site_menu_items i where i.menu_id = m.id);

insert into public.site_pages (locale, slug, title, kind, template, status, published_at, seo)
values (
  'en', 'home', 'Home', 'home', 'home', 'published', now(),
  jsonb_build_object(
    'title', 'MMD Delivery — We Deliver With Heart',
    'description', 'Taxi, food delivery, packages, marketplace and business tools in one platform.',
    'robots', 'index,follow'
  )
)
on conflict (locale, slug) do nothing;

-- Home blocks (idempotent by page + sort_order when empty)
do $$
declare
  pid uuid;
  n int;
begin
  select id into pid from public.site_pages where locale = 'en' and slug = 'home';
  if pid is null then return; end if;
  select count(*) into n from public.site_page_blocks where page_id = pid;
  if n > 0 then return; end if;

  insert into public.site_page_blocks (page_id, block_type, sort_order, visible, status, published_at, payload) values
  (pid, 'hero', 10, true, 'published', now(), jsonb_build_object(
    'eyebrow', 'MMD Delivery',
    'headline', 'We Deliver With Heart',
    'subheadline', 'A modern platform for taxi, food, packages, marketplace shopping, and business logistics — secure payments, live GPS, and smart dispatch.',
    'image_url', '/brand/hero/hero-rider.png',
    'primary_ctas', jsonb_build_array(
      jsonb_build_object('label', 'App Store', 'href', '/download', 'event', 'store_click_ios'),
      jsonb_build_object('label', 'Google Play', 'href', '/download', 'event', 'store_click_android'),
      jsonb_build_object('label', 'Web App', 'href', '/download', 'event', 'store_click_web')
    ),
    'secondary_ctas', jsonb_build_array(
      jsonb_build_object('label', 'Become a Driver', 'href', '/drivers', 'event', 'cta_driver'),
      jsonb_build_object('label', 'Partner Restaurant', 'href', '/p/restaurants', 'event', 'cta_restaurant'),
      jsonb_build_object('label', 'Marketplace', 'href', '/marketplace', 'event', 'cta_marketplace'),
      jsonb_build_object('label', 'Business', 'href', '/p/business', 'event', 'cta_business')
    ),
    'benefits', jsonb_build_array(
      'Secure Stripe payments',
      'Live GPS tracking',
      'Smart dispatch',
      'Unified wallets'
    )
  )),
  (pid, 'services', 20, true, 'published', now(), jsonb_build_object(
    'title', 'Everything you need to move',
    'subtitle', 'One platform for riders, hungry customers, packages, sellers, restaurants, drivers, and businesses.',
    'items', jsonb_build_array(
      jsonb_build_object('key','taxi','title','Taxi','description','Quote, pay, ride, and track with professional drivers.','href','/drivers'),
      jsonb_build_object('key','food','title','Food Delivery','description','Browse restaurants, checkout securely, track to your door.','href','/p/restaurants'),
      jsonb_build_object('key','package','title','Package Delivery','description','Send parcels with pickup codes, proof, and live ETA.','href','/how-it-works'),
      jsonb_build_object('key','marketplace','title','Marketplace','description','Shop local sellers with delivery built in.','href','/marketplace'),
      jsonb_build_object('key','business','title','Business','description','Corporate wallets, employee rides, and admin controls.','href','/p/business'),
      jsonb_build_object('key','driver','title','Drive with MMD','description','Earn with flexible missions across taxi, food, and packages.','href','/drivers'),
      jsonb_build_object('key','restaurant','title','Restaurant partners','description','Command center, menus, prep, and payouts.','href','/p/restaurants')
    )
  )),
  (pid, 'features', 30, true, 'published', now(), jsonb_build_object(
    'title', 'Why choose MMD Delivery',
    'items', jsonb_build_array(
      jsonb_build_object('title','Secure payments','description','Stripe Checkout with pay-then-create integrity.'),
      jsonb_build_object('title','Real-time GPS','description','Live maps for clients, drivers, and partners.'),
      jsonb_build_object('title','Smart dispatch','description','Wave-based matching for food, packages, and taxi.'),
      jsonb_build_object('title','Wallets','description','Client credit, driver Connect, business top-up.'),
      jsonb_build_object('title','Restaurant tools','description','Orders, prep status, and earnings in one place.'),
      jsonb_build_object('title','Business suite','description','Teams, approvals, and corporate travel controls.'),
      jsonb_build_object('title','Marketplace','description','Catalog, checkout, and delivery orchestration.'),
      jsonb_build_object('title','Support','description','Help center and human support when you need it.')
    )
  )),
  (pid, 'mission_vision_values', 40, true, 'published', now(), jsonb_build_object(
    'mission', jsonb_build_object('title','Our mission','body','Make reliable local delivery accessible — with heart, safety, and modern technology.'),
    'vision', jsonb_build_object('title','Our vision','body','A single trusted platform for every trip, meal, parcel, and business delivery.'),
    'values', jsonb_build_array(
      jsonb_build_object('title','Reliability','body','Operations built for production, not prototypes.'),
      jsonb_build_object('title','Safety','body','Identity, tracking, and clear accountability.'),
      jsonb_build_object('title','Partnership','body','Drivers, restaurants, and sellers grow with us.')
    )
  )),
  (pid, 'how_it_works', 50, true, 'published', now(), jsonb_build_object(
    'title', 'How it works',
    'steps', jsonb_build_array(
      jsonb_build_object('title','Estimate','body','Get a transparent quote before you pay.'),
      jsonb_build_object('title','Pay securely','body','Stripe confirms payment — then we create the job.'),
      jsonb_build_object('title','Track live','body','Follow dispatch, pickup, and delivery in real time.'),
      jsonb_build_object('title','Done','body','Receipts, ratings, and support when you need them.')
    )
  )),
  (pid, 'cta', 60, true, 'published', now(), jsonb_build_object(
    'title', 'Ready to get started?',
    'body', 'Download the app or join as a driver, restaurant, seller, or business.',
    'buttons', jsonb_build_array(
      jsonb_build_object('label','Download the app','href','/download','event','store_click_web'),
      jsonb_build_object('label','Contact us','href','/contact','event','cta_contact')
    )
  )),
  (pid, 'faq', 70, true, 'published', now(), jsonb_build_object(
    'title', 'Frequently asked questions',
    'source', 'site_faq'
  )),
  (pid, 'blog_teaser', 80, true, 'published', now(), jsonb_build_object(
    'title', 'News & updates',
    'limit', 3
  ));
end $$;

insert into public.site_pages (locale, slug, title, kind, template, status, published_at, seo)
select 'en', x.slug, x.title, 'marketing', 'standard', 'published', now(),
  jsonb_build_object('title', x.title || ' — MMD Delivery', 'description', x.description, 'robots', 'index,follow')
from (values
  ('company', 'Company', 'Mission, vision, and values behind MMD Delivery.'),
  ('drivers', 'Drive with MMD', 'Become a driver and earn with flexible missions.'),
  ('restaurants', 'Restaurant partners', 'Grow orders with MMD restaurant tools.'),
  ('marketplace', 'Marketplace', 'Sell and shop with built-in delivery.'),
  ('business', 'Business', 'Corporate wallets, teams, and approved rides.'),
  ('how-it-works', 'How it works', 'From quote to delivery — the MMD flow.'),
  ('faq', 'FAQ', 'Answers about MMD Delivery.'),
  ('partners', 'Partners', 'Companies building with MMD.'),
  ('careers', 'Careers', 'Join the MMD team.'),
  ('press', 'Press', 'Newsroom and media resources.'),
  ('contact', 'Contact', 'Reach the MMD team.')
) as x(slug, title, description)
on conflict (locale, slug) do nothing;

-- Simple rich_text bodies for key pages if no blocks yet
do $$
declare
  r record;
  n int;
begin
  for r in
    select id, slug, title from public.site_pages where locale = 'en' and slug <> 'home'
  loop
    select count(*) into n from public.site_page_blocks where page_id = r.id;
    if n = 0 then
      insert into public.site_page_blocks (page_id, block_type, sort_order, visible, status, published_at, payload)
      values (
        r.id, 'rich_text', 10, true, 'published', now(),
        jsonb_build_object(
          'title', r.title,
          'body_md', case r.slug
            when 'company' then 'MMD Delivery exists to move people and goods with reliability and care. We build production-grade infrastructure for taxi, food, packages, marketplace, and business logistics.'
            when 'drivers' then 'Join MMD as a driver. Accept missions across taxi, food, and packages. Track earnings in your wallet and cash out via Stripe Connect when eligible.\n\n[Get started](/signup)'
            when 'restaurants' then 'Partner restaurants receive orders in a command center, manage menus and prep, and get paid through Connect.\n\n[Become a partner](/signup/restaurant)'
            when 'marketplace' then 'Sellers list products, fulfill orders, and reach customers with delivery built into the platform.\n\n[Explore marketplace](/download)'
            when 'business' then 'Give your team corporate rides with wallets, approvals, and admin controls.\n\n[Talk to sales](/contact)'
            when 'how-it-works' then '1. Estimate your trip or order.\n2. Pay securely with Stripe.\n3. We create the job only after payment confirmation.\n4. Track live until delivery.'
            when 'contact' then 'Email support@mmddelivery.com or use the contact form. We typically respond within one business day.'
            when 'careers' then 'We are building carefully. Open roles will appear here — follow the blog for updates.'
            when 'press' then 'For media inquiries, contact support@mmddelivery.com.'
            when 'partners' then 'Strategic and technology partners will be listed here.'
            when 'faq' then 'Browse common questions below, or contact support.'
            else r.title
          end
        )
      );
      if r.slug = 'faq' then
        insert into public.site_page_blocks (page_id, block_type, sort_order, visible, status, published_at, payload)
        values (r.id, 'faq', 20, true, 'published', now(), jsonb_build_object('title','FAQ','source','site_faq'));
      end if;
      if r.slug = 'contact' then
        insert into public.site_page_blocks (page_id, block_type, sort_order, visible, status, published_at, payload)
        values (r.id, 'contact', 20, true, 'published', now(), jsonb_build_object('title','Send a message'));
      end if;
    end if;
  end loop;
end $$;

insert into public.site_faq_items (locale, category, question, answer_md, sort_order)
select 'en', x.category, x.question, x.answer_md, x.sort_order
from (values
  ('general', 'What is MMD Delivery?', 'MMD Delivery is a multi-service platform for taxi, food delivery, packages, marketplace, and business logistics.', 10),
  ('payments', 'When is my order created?', 'For card payments, your order or ride is created only after Stripe confirms payment.', 20),
  ('drivers', 'How do drivers get paid?', 'Eligible earnings settle through Stripe Connect according to platform payout rules.', 30),
  ('business', 'Do you support corporate accounts?', 'Yes — business wallets, members, and ride approvals are available.', 40)
) as x(category, question, answer_md, sort_order)
where not exists (select 1 from public.site_faq_items f where f.locale = 'en' limit 1);

commit;
