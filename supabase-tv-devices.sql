-- Cadastro, presença, agrupamento e programação por TV.
-- Execute uma vez no SQL Editor do Supabase.
begin;

create table if not exists public.tv_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.tv_devices (
  id uuid primary key,
  name text,
  group_id uuid references public.tv_groups(id) on delete set null,
  screen_order integer not null default 1 check (screen_order between 1 and 100),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists tv_devices_presence_idx on public.tv_devices(last_seen_at desc);
create index if not exists tv_devices_group_order_idx on public.tv_devices(group_id, screen_order);

create table if not exists public.tv_device_playback (
  device_id uuid primary key references public.tv_devices(id) on delete cascade,
  playlist_id uuid references public.playlists(id) on delete cascade,
  current_video_id uuid references public.videos(id) on delete set null,
  action text not null default 'pause' check (action in ('play','pause')),
  position_seconds double precision not null default 0 check (position_seconds >= 0),
  updated_at timestamptz not null default now()
);

alter table public.tv_groups enable row level security;
alter table public.tv_devices enable row level security;
alter table public.tv_device_playback enable row level security;

revoke all on table public.tv_groups, public.tv_devices, public.tv_device_playback from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.tv_groups to authenticated;
grant select, update on table public.tv_devices to authenticated;
grant select on table public.tv_device_playback to anon, authenticated;
grant insert, update, delete on table public.tv_device_playback to authenticated;

drop policy if exists "Authenticated manage TV groups" on public.tv_groups;
create policy "Authenticated manage TV groups" on public.tv_groups for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated manage TV devices" on public.tv_devices;
create policy "Authenticated manage TV devices" on public.tv_devices for all to authenticated using (true) with check (true);
drop policy if exists "Read TV playback state" on public.tv_device_playback;
create policy "Read TV playback state" on public.tv_device_playback for select to anon, authenticated using (true);
drop policy if exists "Authenticated manage TV playback state" on public.tv_device_playback;
create policy "Authenticated manage TV playback state" on public.tv_device_playback for all to authenticated using (true) with check (true);

create or replace function public.register_tv_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.tv_devices(id, last_seen_at)
  values (p_device_id, now())
  on conflict (id) do update set last_seen_at = excluded.last_seen_at;
end;
$$;
revoke all on function public.register_tv_device(uuid) from public;
grant execute on function public.register_tv_device(uuid) to anon, authenticated;

create or replace function public.advance_tv_device_playback(expected_device_id uuid, expected_current_video_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.tv_device_playback%rowtype;
  v_current_position bigint;
  v_total_items bigint;
  v_next_video_id uuid;
begin
  select * into v_state
  from public.tv_device_playback
  where device_id = expected_device_id
  for update;

  if not found
     or v_state.action is distinct from 'play'
     or v_state.current_video_id is distinct from expected_current_video_id
     or v_state.playlist_id is null then
    return false;
  end if;

  select item_position, total_items into v_current_position, v_total_items
  from (
    select video_id,
           row_number() over (order by sort_order, created_at, id) as item_position,
           count(*) over () as total_items
    from public.playlist_items
    where playlist_id = v_state.playlist_id
  ) ordered_items
  where video_id = v_state.current_video_id;
  if not found or v_total_items = 0 then return false; end if;

  select video_id into v_next_video_id
  from (
    select video_id, row_number() over (order by sort_order, created_at, id) as item_position
    from public.playlist_items
    where playlist_id = v_state.playlist_id
  ) ordered_items
  where item_position = case when v_current_position >= v_total_items then 1 else v_current_position + 1 end;

  update public.tv_device_playback
  set current_video_id = v_next_video_id, action = 'play', position_seconds = 0, updated_at = now()
  where device_id = expected_device_id;
  return true;
end;
$$;
revoke all on function public.advance_tv_device_playback(uuid, uuid) from public;
grant execute on function public.advance_tv_device_playback(uuid, uuid) to anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.tv_devices;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.tv_device_playback;
exception when duplicate_object then null;
end $$;

commit;
