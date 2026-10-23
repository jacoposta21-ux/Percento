-- Room settings chosen by the host: seconds per question (10/15/20/25) and,
-- for the last-one-standing games, lives (1/3/5). Public games keep the
-- defaults (15 seconds, 1 life) so strangers all play by the same rules.
alter table public.rooms add column lives smallint not null default 1 check (lives in (1, 3, 5));
alter table public.room_players add column misses smallint not null default 0;

create function public.create_room(room_category text, room_mode text, room_seconds integer, room_lives integer) returns text
language plpgsql security definer set search_path = '' as $$
declare
  new_code text;
begin
  if room_seconds not in (10, 15, 20, 25) then raise exception 'Pick 10, 15, 20 or 25 seconds'; end if;
  if room_lives not in (1, 3, 5) then raise exception 'Pick 1, 3 or 5 lives'; end if;
  new_code := public.create_room(room_category, room_mode);
  update public.rooms set round_seconds = room_seconds, lives = case when room_mode = 'guess' then 1 else room_lives end
    where code = new_code;
  return new_code;
end $$;

-- A player is out once their misses use up the room's lives.
create function public.report_room_score(room_code text, new_score integer, still_alive boolean, new_misses integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
  m smallint;
begin
  select * into r from public.rooms where code = upper(room_code) for update;
  if not found or r.status <> 'playing' then return; end if;
  m := least(greatest(new_misses, 0), r.lives);
  update public.room_players
    set score = greatest(score, least(new_score, 1000)),
        misses = greatest(misses, m),
        alive = alive and still_alive and greatest(misses, m) < r.lives,
        finished_at = case when still_alive and greatest(misses, m) < r.lives then finished_at else coalesce(finished_at, now()) end
    where room_id = r.id and user_id = auth.uid() and alive;
  if not exists (select 1 from public.room_players where room_id = r.id and alive) then
    update public.rooms set status = 'finished' where id = r.id;
  end if;
end $$;

revoke execute on function public.create_room(text, text, integer, integer),
  public.report_room_score(text, integer, boolean, integer) from public, anon;
grant execute on function public.create_room(text, text, integer, integer),
  public.report_room_score(text, integer, boolean, integer) to authenticated;
