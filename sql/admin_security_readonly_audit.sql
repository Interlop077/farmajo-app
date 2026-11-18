-- FARMAJO: read-only audit before enabling single-admin write protection.
-- SELECT-only diagnostics. This script does not modify tables, policies, grants or files.

-- 1) Actual columns for every table written by public/admin.html.
select table_schema, table_name, ordinal_position, column_name, data_type,
       udt_name, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and table_name in ('categories','items','screens','screen_categories','videos','settings')
order by table_name, ordinal_position;

-- 2) RLS status for those tables.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('categories','items','screens','screen_categories','videos','settings')
order by c.relname;

-- 3) Every policy on those tables. Broad permissive policies must be accounted for.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname='public'
  and tablename in ('categories','items','screens','screen_categories','videos','settings')
order by tablename, policyname;

-- 4) Effective table privileges. TRUNCATE is especially important because RLS does not protect it.
select t.table_name, r.role_name,
       has_table_privilege(r.role_name, format('%I.%I','public',t.table_name), 'SELECT') as can_select,
       has_table_privilege(r.role_name, format('%I.%I','public',t.table_name), 'INSERT') as can_insert,
       has_table_privilege(r.role_name, format('%I.%I','public',t.table_name), 'UPDATE') as can_update,
       has_table_privilege(r.role_name, format('%I.%I','public',t.table_name), 'DELETE') as can_delete,
       has_table_privilege(r.role_name, format('%I.%I','public',t.table_name), 'TRUNCATE') as can_truncate,
       has_table_privilege(r.role_name, format('%I.%I','public',t.table_name), 'REFERENCES') as can_references,
       has_table_privilege(r.role_name, format('%I.%I','public',t.table_name), 'TRIGGER') as can_trigger
from (values ('categories'),('items'),('screens'),('screen_categories'),('videos'),('settings')) t(table_name)
cross join (values ('anon'),('authenticated'),('service_role')) r(role_name)
where to_regclass(format('%I.%I','public',t.table_name)) is not null
order by t.table_name,r.role_name;

-- 5) Storage buckets and public/private settings.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id='media';

-- 6) All storage.objects policies. Policies are table-wide, so we must inspect them
-- before changing media permissions without accidentally affecting other buckets.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname='storage' and tablename='objects'
order by policyname;

-- 7) Effective storage.objects privileges.
select r.role_name,
       has_table_privilege(r.role_name, 'storage.objects', 'SELECT') as can_select,
       has_table_privilege(r.role_name, 'storage.objects', 'INSERT') as can_insert,
       has_table_privilege(r.role_name, 'storage.objects', 'UPDATE') as can_update,
       has_table_privilege(r.role_name, 'storage.objects', 'DELETE') as can_delete,
       has_table_privilege(r.role_name, 'storage.objects', 'TRUNCATE') as can_truncate
from (values ('anon'),('authenticated'),('service_role')) r(role_name);

-- 8) Function execute grants for custom public functions.
select p.oid::regprocedure as function_signature,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and (p.proname like '%admin%' or p.proname like '%menu%' or p.proname like '%draft%')
order by p.proname;
