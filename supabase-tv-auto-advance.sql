-- Permite que o player público da TV avance a playlist ao terminar um vídeo,
-- sem conceder a ele permissão geral para editar playback_state.
create or replace function public.advance_tv_playback(expected_current_video_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.playback_state%rowtype;
  v_current_position bigint;
  v_total_items bigint;
  v_next_video_id uuid;
begin
  select * into v_state
  from public.playback_state
  where id = 1
  for update;

  if not found
     or v_state.action is distinct from 'play'
     or v_state.current_video_id is distinct from expected_current_video_id
     or v_state.playlist_id is null then
    return false;
  end if;

  select item_position, total_items
  into v_current_position, v_total_items
  from (
    select video_id,
           row_number() over (order by sort_order, created_at, id) as item_position,
           count(*) over () as total_items
    from public.playlist_items
    where playlist_id = v_state.playlist_id
  ) ordered_items
  where video_id = v_state.current_video_id;

  if not found or v_total_items = 0 then
    return false;
  end if;

  select video_id into v_next_video_id
  from (
    select video_id,
           row_number() over (order by sort_order, created_at, id) as item_position
    from public.playlist_items
    where playlist_id = v_state.playlist_id
  ) ordered_items
  where item_position = case
    when v_current_position >= v_total_items then 1
    else v_current_position + 1
  end;

  update public.playback_state
  set current_video_id = v_next_video_id,
      action = 'play',
      position_seconds = 0,
      updated_at = now()
  where id = 1;

  return true;
end;
$$;

revoke all on function public.advance_tv_playback(uuid) from public;
grant execute on function public.advance_tv_playback(uuid) to anon, authenticated;
