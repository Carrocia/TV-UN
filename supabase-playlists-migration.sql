-- Migração do TV-UNI para playlists nomeadas, ordem e efeitos por vídeo.
-- Execute uma única vez no SQL Editor do Supabase.
begin;

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  sort_order integer not null default 0,
  transition_effect text not null default 'none' check (transition_effect in ('none','fade','slide')),
  created_at timestamptz not null default now(),
  unique (playlist_id, video_id)
);
create index if not exists playlist_items_order_idx on public.playlist_items(playlist_id, sort_order);

alter table public.playback_state add column if not exists playlist_id uuid references public.playlists(id) on delete set null;

-- Move the existing single video list into one initial playlist without deleting files.
do $$
declare
  default_playlist_id uuid;
begin
  if not exists (select 1 from public.playlists) then
    insert into public.playlists(name) values ('Playlist padrão') returning id into default_playlist_id;
    insert into public.playlist_items(playlist_id, video_id, sort_order)
    select default_playlist_id, id, row_number() over (order by sort_order nulls last, created_at, id) - 1
    from public.videos
    on conflict (playlist_id, video_id) do nothing;
  else
    select id into default_playlist_id from public.playlists order by created_at limit 1;
  end if;

  update public.playback_state
  set playlist_id = default_playlist_id
  where id = 1 and playlist_id is null;
end $$;

alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;

-- Some newer Supabase projects do not grant Data API table privileges by default.
grant usage on schema public to anon, authenticated;
grant select on table public.playlists, public.playlist_items to anon, authenticated;
grant insert, update, delete on table public.playlists, public.playlist_items to authenticated;

drop policy if exists "Anyone can read playlists" on public.playlists;
create policy "Anyone can read playlists" on public.playlists for select to anon, authenticated using (true);
drop policy if exists "Authenticated users manage playlists" on public.playlists;
create policy "Authenticated users manage playlists" on public.playlists for all to authenticated using (true) with check (true);

drop policy if exists "Anyone can read playlist items" on public.playlist_items;
create policy "Anyone can read playlist items" on public.playlist_items for select to anon, authenticated using (true);
drop policy if exists "Authenticated users manage playlist items" on public.playlist_items;
create policy "Authenticated users manage playlist items" on public.playlist_items for all to authenticated using (true) with check (true);

-- Ensure connected TV browsers receive playlist edits and playback commands.
do $$ begin
  alter publication supabase_realtime add table public.playlists;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.playlist_items;
exception when duplicate_object then null;
end $$;

commit;
