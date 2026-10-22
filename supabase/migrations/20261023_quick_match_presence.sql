-- Public matchmaking with strangers, per-room categories and presence
-- (players who close the tab drop out instead of blocking the room).

alter table public.rooms add column is_public boolean not null default false;
alter table public.rooms add column starts_at timestamptz;
alter table public.rooms add column category text;
alter table public.room_players add column last_seen timestamptz not null default now();
create index rooms_open_public on public.rooms (created_at) where is_public and status = 'lobby';

-- Shared housekeeping: drop players who left or went silent, schedule and start
-- public games (20 s after the second player, at once with 10), end games nobody plays.
create or replace function public.room_tick(room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
  n integer;
begin
  select * into r from public.rooms where id = room_id for update;
  if not found then return; end if;
  if r.status = 'lobby' then
    -- Players who left (last_seen = -infinity) or went silent in a public lobby.
    delete from public.room_players p where p.room_id = r.id
      and (p.last_seen = '-infinity' or (r.is_public and p.last_seen < now() - interval '20 seconds'));
    select count(*) into n from public.room_players p where p.room_id = r.id;
    if n = 0 then delete from public.rooms where id = r.id; return; end if;
    if r.is_public then
      if n >= 10 then
        update public.rooms set starts_at = least(coalesce(starts_at, now()), now()) where id = r.id;
      elsif n >= 2 and r.starts_at is null then
        update public.rooms set starts_at = now() + interval '20 seconds' where id = r.id;
      elsif n < 2 then
        update public.rooms set starts_at = null where id = r.id;
      end if;
      update public.rooms set status = 'playing', started_at = now()
        where id = r.id and starts_at is not null and starts_at <= now() and n >= 2;
      if found then update public.room_players p set last_seen = now() where p.room_id = r.id; end if;
    end if;
  elsif r.status = 'playing' then
    update public.room_players p set alive = false, finished_at = coalesce(p.finished_at, now())
      where p.room_id = r.id and p.alive and p.last_seen < now() - interval '25 seconds';
    if not exists (select 1 from public.room_players p where p.room_id = r.id and p.alive) then
      update public.rooms set status = 'finished' where id = r.id;
    end if;
  end if;
end $$;

-- Join the oldest open public lobby, or open a new one.
create function public.quick_match() returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rooms;
  new_code text;
  old record;
begin
  if me is null then raise exception 'Sign in to play online'; end if;
  select ro.* into r from public.rooms ro join public.room_players p on p.room_id = ro.id and p.user_id = me
    where ro.is_public and ro.status = 'lobby' limit 1;
  if found then
    update public.room_players set last_seen = now() where room_id = r.id and user_id = me;
    return r.code;
  end if;
  for old in select id from public.rooms where is_public and status = 'lobby' loop
    perform public.room_tick(old.id);
  end loop;
  select * into r from public.rooms ro
    where ro.is_public and ro.status = 'lobby'
      and (select count(*) from public.room_players p where p.room_id = ro.id) < 10
    order by ro.created_at limit 1 for update skip locked;
  if not found then
    loop
      new_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
      exit when not exists (select 1 from public.rooms where code = new_code);
    end loop;
    insert into public.rooms (code, host_id, seed, is_public) values (new_code, me, floor(random() * 2147483647)::bigint, true)
      returning * into r;
  end if;
  insert into public.room_players (room_id, user_id, username)
    select r.id, me, username from public.profiles where id = me;
  perform public.room_tick(r.id);
  return r.code;
end $$;

-- Called every few seconds by each player on the room screen.
create function public.room_heartbeat(room_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
begin
  select id into rid from public.rooms where code = upper(room_code);
  if rid is null then return; end if;
  update public.room_players set last_seen = now() where room_id = rid and user_id = auth.uid();
  perform public.room_tick(rid);
end $$;

-- Leave a lobby (a game in progress is left by losing).
create function public.leave_room(room_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
begin
  select id into rid from public.rooms where code = upper(room_code) and status = 'lobby';
  if rid is null then return; end if;
  -- room_tick removes players marked as gone.
  update public.room_players set last_seen = '-infinity' where room_id = rid and user_id = auth.uid();
  perform public.room_tick(rid);
end $$;

-- Friend room limited to one category (the no-argument version stays for all categories).
create function public.create_room(room_category text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  new_code text;
  room uuid;
begin
  if me is null then raise exception 'Sign in to create a room'; end if;
  if room_category is not null and room_category !~ '^[a-z]{3,12}$' then raise exception 'Unknown category'; end if;
  loop
    new_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.rooms where code = new_code);
  end loop;
  insert into public.rooms (code, host_id, seed, category) values (new_code, me, floor(random() * 2147483647)::bigint, room_category)
    returning id into room;
  insert into public.room_players (room_id, user_id, username)
    select room, me, username from public.profiles where id = me;
  return new_code;
end $$;

-- Scores also count as a sign of life.
create or replace function public.report_room_score(room_code text, new_score integer, still_alive boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where code = upper(room_code) for update;
  if not found or r.status <> 'playing' then return; end if;
  update public.room_players
    set score = greatest(score, least(new_score, 1000)),
        alive = alive and still_alive,
        last_seen = now(),
        finished_at = case when still_alive then finished_at else coalesce(finished_at, now()) end
    where room_id = r.id and user_id = auth.uid() and alive;
  perform public.room_tick(r.id);
end $$;

-- Only friend rooms are started by hand; everyone gets a fresh presence window.
create or replace function public.start_room(room_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
begin
  update public.rooms set status = 'playing', started_at = now()
    where code = upper(room_code) and host_id = auth.uid() and status = 'lobby' and not is_public
    returning id into rid;
  if rid is null then raise exception 'Only the host can start this room'; end if;
  update public.room_players set last_seen = now() where room_id = rid;
end $$;

revoke execute on function public.quick_match(), public.room_heartbeat(text), public.leave_room(text),
  public.create_room(text), public.room_tick(uuid) from public, anon;
revoke execute on function public.room_tick(uuid) from authenticated;
grant execute on function public.quick_match(), public.room_heartbeat(text), public.leave_room(text),
  public.create_room(text) to authenticated;
