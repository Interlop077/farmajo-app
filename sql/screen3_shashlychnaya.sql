-- FARMAJO: отдельная база категорий для экрана шашлычной.
-- Запустить один раз в Supabase SQL Editor после создания ветки/перед публикацией.
-- Категории создаются отдельными строками и привязываются ТОЛЬКО к screen3.
-- Существующие категории и позиции screen1/screen2 не переиспользуются и не меняются.

begin;

alter table public.items
  add column if not exists weight_g integer;

insert into public.screens (id, name, menu_width, video_enabled)
values ('screen3', 'Шашлычная', 100, false)
on conflict (id) do nothing;

with desired(name, sort) as (
  values
    ('Шашлык', 0),
    ('Люля-кебаб', 1),
    ('Блюда на гриле', 2),
    ('Гарниры', 3),
    ('Закуски', 4),
    ('Соусы', 5),
    ('Напитки', 6)
),
inserted as (
  insert into public.categories (name, season, sort)
  select d.name, null, d.sort
  from desired d
  where not exists (
    select 1
    from public.categories c
    join public.screen_categories sc on sc.category_id = c.id
    where sc.screen_id = 'screen3'
      and c.name = d.name
  )
  returning id, name
),
screen3_categories as (
  select c.id, c.name
  from public.categories c
  join public.screen_categories sc on sc.category_id = c.id
  where sc.screen_id = 'screen3'
    and c.name in (select name from desired)
  union
  select id, name from inserted
)
insert into public.screen_categories (screen_id, category_id, visible, sort)
select 'screen3', c.id, true, d.sort
from screen3_categories c
join desired d on d.name = c.name
on conflict (screen_id, category_id)
do update set visible = true, sort = excluded.sort;

commit;
