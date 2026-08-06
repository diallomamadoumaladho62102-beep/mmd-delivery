-- site_menu_items schema notes (read-only reference)
--
-- Correct join pattern — use menu_id (FK to site_menus.id).
-- NEVER select a column named "menu" from site_menu_items; it does not exist.
--
-- Example:
--   select m.key as menu_key, i.label, i.href, i.sort_order, i.visible
--   from public.site_menu_items i
--   join public.site_menus m on m.id = i.menu_id
--   where m.locale = 'en'
--   order by m.key, i.sort_order;

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'site_menu_items'
order by ordinal_position;
