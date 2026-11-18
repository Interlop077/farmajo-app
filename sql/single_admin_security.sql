-- FARMAJO: single-admin write protection.
-- PREPARED FOR MANUAL REVIEW. This file is NOT executed by GitHub or Netlify.
-- Run only in Supabase SQL Editor after reviewing and confirming a backup.
-- Public menu/media reads remain available. Only app_metadata.role = 'admin' may write.
-- No rows, menu data, categories, screens, or media objects are modified by this migration.

begin;

-- 1) Keep public reads; remove dangerous table-level capabilities.
revoke truncate, references, trigger
  on table public.categories, public.items, public.screens,
            public.screen_categories, public.videos, public.settings
  from public, anon, authenticated;

-- Anonymous visitors must never write.
revoke insert, update, delete
  on table public.categories, public.items, public.screens,
            public.screen_categories, public.videos, public.settings
  from public, anon;

-- Authenticated users need DML grants for the admin RLS policies below to work.
-- The grants alone do not authorize writes; RLS restricts them to the trusted admin claim.
grant select on table public.categories, public.items, public.screens,
                     public.screen_categories, public.videos, public.settings
  to anon, authenticated;
grant insert, update, delete
  on table public.categories, public.items, public.screens,
            public.screen_categories, public.videos, public.settings
  to authenticated;

-- 2) Replace broad authenticated write policies with trusted app_metadata role checks.

drop policy if exists "write categories" on public.categories;
drop policy if exists "admin write categories" on public.categories;
create policy "admin write categories"
  on public.categories for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "write items" on public.items;
drop policy if exists "admin write items" on public.items;
create policy "admin write items"
  on public.items for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "write screens" on public.screens;
drop policy if exists "admin write screens" on public.screens;
create policy "admin write screens"
  on public.screens for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "write screen_categories" on public.screen_categories;
drop policy if exists "admin write screen_categories" on public.screen_categories;
create policy "admin write screen_categories"
  on public.screen_categories for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "write videos" on public.videos;
drop policy if exists "admin write videos" on public.videos;
create policy "admin write videos"
  on public.videos for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "write settings" on public.settings;
drop policy if exists "admin write settings" on public.settings;
create policy "admin write settings"
  on public.settings for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- 3) Storage: keep public reads for the public media bucket; restrict all writes to admin.
revoke truncate, references, trigger on table storage.objects
  from public, anon, authenticated;
revoke insert, update, delete on table storage.objects from public, anon;
grant select on table storage.objects to anon, authenticated;
grant insert, update, delete on table storage.objects to authenticated;

drop policy if exists "media write" on storage.objects;
drop policy if exists "media admin write" on storage.objects;
create policy "media admin write"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'media'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    bucket_id = 'media'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

commit;

-- After running, sign out and sign in again so the JWT contains the updated app_metadata claim.
-- Verify with the read-only audit: anon has no DML/TRUNCATE; authenticated has no TRUNCATE;
-- all six table write policies and the media write policy require app_metadata.role = 'admin'.
