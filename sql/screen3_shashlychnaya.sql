-- FARMAJO / screen3: отдельные категории шашлычной.
-- Идемпотентно: повторный запуск находит только screen3-категории,
-- которые НЕ связаны с screen1 или screen2. Общие категории не переиспользуются.
-- weight_g nullable; volume_ml и существующие записи не затрагиваются.

begin;
select pg_advisory_xact_lock(hashtext('farmajo:screen3:shashlychnaya'));

alter table public.items add column if not exists weight_g integer;

insert into public.screens (id, name, menu_width, video_enabled)
values ('screen3', 'Шашлычная', 100, false)
on conflict (id) do nothing;

do $migration$
declare
  v_name text;
  v_sort integer;
  v_category_id uuid;
begin
  for v_name, v_sort in
    select * from (values
      ('Шашлык', 0),
      ('Люля-кебаб', 1),
      ('Блюда на гриле', 2),
      ('Гарниры', 3),
      ('Закуски', 4),
      ('Соусы', 5),
      ('Напитки к шашлыку', 6)
    ) as desired(name, sort)
  loop
    -- Берём только уже отдельную категорию screen3.
    select c.id into v_category_id
    from public.categories c
    join public.screen_categories s3
      on s3.category_id = c.id and s3.screen_id = 'screen3'
    where c.name = v_name
      and not exists (
        select 1 from public.screen_categories legacy
        where legacy.category_id = c.id
          and legacy.screen_id in ('screen1', 'screen2')
      )
    order by c.id
    limit 1;

    -- Если есть только общая категория (или нет категории), создаём новую строку/ID.
    if v_category_id is null then
      insert into public.categories (name, season, sort)
      values (v_name, null, v_sort)
      returning id into v_category_id;
    end if;

    insert into public.screen_categories (screen_id, category_id, visible, sort)
    values ('screen3', v_category_id, true, v_sort)
    on conflict (screen_id, category_id)
    do update set sort = excluded.sort;
  end loop;
end
$migration$;

commit;
