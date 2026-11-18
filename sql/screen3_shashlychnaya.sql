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

-- Если общая категория уже содержит блюда, нельзя автоматически решить,
-- какие из них относятся к шашлычной. Останавливаем миграцию, чтобы не скрыть
-- существующие позиции screen3 и не затронуть данные экранов 1/2.
do $guard$
begin
  if exists (
    select 1
    from public.screen_categories s3
    join public.screen_categories legacy
      on legacy.category_id = s3.category_id
     and legacy.screen_id in ('screen1', 'screen2')
    join public.items i on i.category_id = s3.category_id
    where s3.screen_id = 'screen3'
  ) then
    raise exception 'Найдены общие категории screen3 и screen1/screen2 с блюдами. Сначала вручную проверьте и разделите позиции; миграция остановлена без изменений.';
  end if;
end
$guard$;

-- Убираем только пустые общие связи screen3. Связи screen1/2 и сами категории/блюда не изменяются.
delete from public.screen_categories s3
using public.screen_categories legacy
where s3.screen_id='screen3'
  and legacy.category_id=s3.category_id
  and legacy.screen_id in ('screen1','screen2');

do $migration$
declare
  v_name text;
  v_sort integer;
  v_category_id public.categories.id%type;
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

    if exists (
      select 1 from public.screen_categories
      where screen_id='screen3' and category_id=v_category_id
    ) then
      update public.screen_categories set sort=v_sort
      where screen_id='screen3' and category_id=v_category_id;
    else
      insert into public.screen_categories (screen_id, category_id, visible, sort)
      values ('screen3', v_category_id, true, v_sort);
    end if;
  end loop;
end
$migration$;

commit;
