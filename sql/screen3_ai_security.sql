begin;

-- FARMAJO AI draft storage + atomic apply.
-- Run manually only after reviewing schema assumptions. This file is NOT executed by this change.
create table if not exists public.ai_menu_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null,
  operations jsonb not null,
  operations_hash text not null,
  mode text not null check (mode in ('mock','openai')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

alter table public.ai_menu_drafts enable row level security;
revoke all on public.ai_menu_drafts from public, anon, authenticated;

create or replace function public.create_ai_menu_draft(
  p_summary text,
  p_operations jsonb,
  p_mode text default 'mock',
  p_ttl_seconds integer default 900,
  p_user_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_hash text;
  v_user uuid := p_user_id;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'server function only' using errcode='42501'; end if;
  if v_user is null then raise exception 'draft owner required' using errcode='28000'; end if;
  if p_mode not in ('mock','openai') then raise exception 'invalid draft mode'; end if;
  if jsonb_typeof(p_operations) <> 'array' or jsonb_array_length(p_operations) > 50 then
    raise exception 'invalid operations';
  end if;
  if p_ttl_seconds < 60 or p_ttl_seconds > 3600 then raise exception 'invalid ttl'; end if;
  v_hash := md5(p_operations::text);
  insert into public.ai_menu_drafts(user_id,summary,operations,operations_hash,mode,expires_at)
  values(v_user,coalesce(p_summary,''),p_operations,v_hash,p_mode,now()+make_interval(secs=>p_ttl_seconds))
  returning id into v_id;
  return jsonb_build_object('draft_id',v_id,'operations_hash',v_hash,
    'summary',coalesce(p_summary,''),'operations',p_operations,'mode',p_mode,
    'expires_at',now()+make_interval(secs=>p_ttl_seconds));
end;
$$;

create or replace function public.apply_ai_menu_draft(
  p_draft_id uuid,
  p_operations_hash text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  d public.ai_menu_drafts%rowtype;
  op jsonb;
  v_category public.categories.id%type;
  v_item public.items.id%type;
  v_patch jsonb;
  v_count integer := 0;
  v_sort integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  if coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'FARMAJO admin role required' using errcode='42501';
  end if;
  select * into d from public.ai_menu_drafts where id=p_draft_id for update;
  if not found then raise exception 'draft not found' using errcode='P0002'; end if;
  if d.user_id <> auth.uid() then raise exception 'draft owner mismatch' using errcode='42501'; end if;
  if d.consumed_at is not null then raise exception 'draft already consumed' using errcode='55000'; end if;
  if d.expires_at <= now() then raise exception 'draft expired' using errcode='22023'; end if;
  if d.mode <> 'openai' then raise exception 'mock drafts are never writable' using errcode='42501'; end if;
  if p_operations_hash is null or p_operations_hash <> d.operations_hash
     or md5(d.operations::text) <> d.operations_hash then
    raise exception 'draft content mismatch' using errcode='22023';
  end if;
  if jsonb_typeof(d.operations) <> 'array' or jsonb_array_length(d.operations)=0
     or jsonb_array_length(d.operations)>50 then raise exception 'invalid draft operations'; end if;

  -- Lock and consume before work; any exception rolls the entire statement back.
  update public.ai_menu_drafts set consumed_at=now() where id=d.id;

  for op in select value from jsonb_array_elements(d.operations)
  loop
    if op->>'type' not in ('create_item','update_item') then raise exception 'operation type not allowed'; end if;
    select c.id into v_category from public.categories c where c.id::text=op->>'category_id';
    if v_category is null then raise exception 'unknown category'; end if;

    if not exists (
      select 1 from public.screen_categories sc
      where sc.screen_id='screen3' and sc.category_id=v_category
    ) or exists (
      select 1 from public.screen_categories sc
      where sc.screen_id in ('screen1','screen2') and sc.category_id=v_category
    ) then raise exception 'category is not exclusive to screen3' using errcode='42501'; end if;

    if op->>'type'='create_item' then
      if coalesce(nullif(trim(op->>'name'),''),'')='' or length(op->>'name')>120 then raise exception 'new item name required or too long'; end if;
      if op->>'price' is not null and ((op->>'price')::numeric < 0 or (op->>'price')::numeric > 1000000) then raise exception 'invalid price'; end if;
      if op->>'weight_g' is not null and ((op->>'weight_g')::integer <= 0 or (op->>'weight_g')::integer > 100000) then raise exception 'invalid weight'; end if;
      select coalesce(max(sort)+1,0) into v_sort from public.items where category_id=v_category;
      insert into public.items(category_id,name,price,weight_g,active,sort)
      values(v_category,op->>'name',nullif(op->>'price','null')::numeric,
        nullif(op->>'weight_g','null')::integer,
        coalesce((op->>'active')::boolean,true),v_sort);
    else
      select i.id into v_item from public.items i where i.id::text=op->>'id' and i.category_id=v_category;
      if v_item is null then
        raise exception 'item is not in exclusive screen3 category' using errcode='42501';
      end if;
      if op ? 'name' and op->>'name' is not null and trim(op->>'name')<>'' and length(op->>'name')<=120 then
        update public.items set name=op->>'name' where id=v_item;
      end if;
      if op ? 'price' and op->>'price' is not null then
        if (op->>'price')::numeric < 0 or (op->>'price')::numeric > 1000000 then raise exception 'invalid price'; end if;
        update public.items set price=(op->>'price')::numeric where id=v_item;
      end if;
      if op ? 'weight_g' and op->>'weight_g' is not null then
        if (op->>'weight_g')::integer <= 0 or (op->>'weight_g')::integer > 100000 then raise exception 'invalid weight'; end if;
        update public.items set weight_g=(op->>'weight_g')::integer where id=v_item;
      end if;
      if op ? 'active' and op->>'active' is not null then
        update public.items set active=(op->>'active')::boolean where id=v_item;
      end if;
    end if;
    v_count := v_count+1;
  end loop;
  return jsonb_build_object('ok',true,'applied',v_count,'draft_id',d.id);
end;
$$;

revoke all on function public.create_ai_menu_draft(text,jsonb,text,integer,uuid) from public, anon, authenticated;
revoke all on function public.apply_ai_menu_draft(uuid,text) from public, anon;
grant execute on function public.create_ai_menu_draft(text,jsonb,text,integer,uuid) to service_role;
grant execute on function public.apply_ai_menu_draft(uuid,text) to authenticated;


commit;
