-- FARMAJO: безопасная диагностика Supabase. Только SELECT / системные каталоги.
-- Не изменяет данные, схему, политики или индексы. Выполнять блоками по необходимости.

-- 1) Структура и типы колонок
select table_schema, table_name, ordinal_position, column_name, data_type,
       udt_name, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and table_name in ('screens','categories','items','screen_categories','ai_menu_drafts')
order by table_name, ordinal_position;

-- 2) PK / UNIQUE / FK / CHECK constraints
select tc.table_name, tc.constraint_name, tc.constraint_type,
       kcu.column_name, ccu.table_name as foreign_table, ccu.column_name as foreign_column,
       cc.check_clause
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_schema=kcu.constraint_schema and tc.constraint_name=kcu.constraint_name
left join information_schema.constraint_column_usage ccu
  on tc.constraint_schema=ccu.constraint_schema and tc.constraint_name=ccu.constraint_name
left join information_schema.check_constraints cc
  on tc.constraint_schema=cc.constraint_schema and tc.constraint_name=cc.constraint_name
where tc.table_schema='public'
  and tc.table_name in ('screens','categories','items','screen_categories','ai_menu_drafts')
order by tc.table_name, tc.constraint_type, tc.constraint_name;

-- 3) Индексы
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname='public'
  and tablename in ('screens','categories','items','screen_categories','ai_menu_drafts')
order by tablename, indexname;

-- 4) RLS enabled/forced
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('screens','categories','items','screen_categories','ai_menu_drafts')
order by c.relname;

-- 5) RLS policies
select schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
from pg_policies
where schemaname='public'
  and tablename in ('screens','categories','items','screen_categories','ai_menu_drafts')
order by tablename, policyname;

-- 6) Категории и привязки экранов
select c.id as category_id, c.name, c.season,
       array_agg(sc.screen_id order by sc.screen_id) as screen_ids,
       count(*) filter (where sc.screen_id in ('screen1','screen2')) as legacy_links,
       count(*) filter (where sc.screen_id='screen3') as screen3_links
from public.categories c
left join public.screen_categories sc on sc.category_id=c.id
group by c.id,c.name,c.season
order by c.name,c.id;

-- 7) Возможные общие категории screen3 + screen1/2 (критический список)
select c.id, c.name,
       array_agg(sc.screen_id order by sc.screen_id) as linked_screens
from public.categories c
join public.screen_categories sc on sc.category_id=c.id
group by c.id,c.name
having bool_or(sc.screen_id='screen3')
   and bool_or(sc.screen_id in ('screen1','screen2'))
order by c.name,c.id;

-- 8) Несвязанные категории / orphan links
select c.id,c.name
from public.categories c
left join public.screen_categories sc on sc.category_id=c.id
where sc.category_id is null
order by c.name,c.id;

select sc.*
from public.screen_categories sc
left join public.screens s on s.id=sc.screen_id
left join public.categories c on c.id=sc.category_id
where s.id is null or c.id is null;

-- 9) Колонки, необходимые для обратно совместимого веса
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name='items'
  and column_name in ('id','category_id','name','price','volume_ml','weight_g','active','sort')
order by ordinal_position;
