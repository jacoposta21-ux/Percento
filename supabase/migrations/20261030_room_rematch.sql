-- Friends stay together after a game: "Play again" in a finished private
-- room opens one new lobby with the same game and settings, and everyone
-- who plays again lands in it (the first to ask becomes its host). The old
-- room points to the new one, so the others' screens can follow.
alter table public.rooms add column next_code text;

create function public.rematch_room(room_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rooms;
  new_code text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into r from public.rooms where code = upper(room_code) for update;
  if not found then raise exception 'Room not found'; end if;
  if not exists (select 1 from public.room_players where room_id = r.id and user_id = me) then raise exception 'Not in this room'; end if;
  if r.is_public then raise exception 'Public games have no rematch'; end if;
  if r.next_code is null then
    new_code := public.create_room(r.category, r.mode, r.round_seconds, coalesce(r.lives, 1));
    update public.rooms set next_code = new_code where id = r.id;
  else
    new_code := r.next_code;
    perform public.join_room(new_code);
  end if;
  return new_code;
end $$;

revoke execute on function public.rematch_room(text) from public, anon;
grant execute on function public.rematch_room(text) to authenticated;
