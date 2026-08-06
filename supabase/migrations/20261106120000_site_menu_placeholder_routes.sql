-- Point header Services to dedicated /services Coming Soon route,
-- and add Cookies to footer legal navigation.

begin;

update public.site_menu_items i
set href = '/services'
from public.site_menus m
where i.menu_id = m.id
  and m.locale = 'en'
  and m.key = 'header'
  and i.label = 'Services'
  and i.href = '/#services';

insert into public.site_menu_items (menu_id, label, href, sort_order)
select m.id, 'Cookies', '/cookies', 25
from public.site_menus m
where m.locale = 'en'
  and m.key = 'footer'
  and not exists (
    select 1
    from public.site_menu_items x
    where x.menu_id = m.id
      and x.href = '/cookies'
  );

commit;
