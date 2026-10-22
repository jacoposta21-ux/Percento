-- "Closest guess": one card per round, every player sets a percentage within
-- the round's time, the closest scores most. Rounds run on the server clock:
-- round i opens at started_at + i × (round_seconds + reveal_seconds).

alter table public.rooms add column mode text not null default 'standing' check (mode in ('standing', 'guess'));
alter table public.rooms add column round_seconds smallint not null default 15;
alter table public.rooms add column reveal_seconds smallint not null default 6;
alter table public.rooms add column rounds smallint not null default 10;

create table public.room_guesses (
  room_id uuid not null references public.rooms on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  round smallint not null check (round between 0 and 49),
  guess numeric(4, 1) not null check (guess between 0 and 100),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id, round)
);
create index room_guesses_user on public.room_guesses (user_id);
alter table public.room_guesses enable row level security;
-- Your own guesses always; everyone else's only once that round's clock has run out.
create policy "guesses after the round" on public.room_guesses for select to authenticated using (
  (select auth.uid()) = user_id or exists (
    select 1 from public.rooms r where r.id = room_id and r.started_at is not null
      and now() >= r.started_at + make_interval(secs => round * (r.round_seconds + r.reveal_seconds) + r.round_seconds)));
alter publication supabase_realtime add table public.room_guesses;

-- Lets phones measure their clock offset.
create function public.server_time() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.server_time() to anon, authenticated;

-- A guess counts only while its round's clock runs (plus a second of network grace).
create function public.submit_guess(room_code text, round_no integer, value numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
  me uuid := auth.uid();
  opens timestamptz;
begin
  select * into r from public.rooms where code = upper(room_code);
  if not found or r.mode <> 'guess' or r.status <> 'playing' then raise exception 'No guessing game running here'; end if;
  if not exists (select 1 from public.room_players p where p.room_id = r.id and p.user_id = me) then raise exception 'You are not in this game'; end if;
  if round_no < 0 or round_no >= r.rounds then raise exception 'No such round'; end if;
  opens := r.started_at + make_interval(secs => round_no * (r.round_seconds + r.reveal_seconds));
  if now() < opens or now() > opens + make_interval(secs => r.round_seconds + 1.5) then raise exception 'Too late for this round'; end if;
  insert into public.room_guesses (room_id, user_id, round, guess)
    values (r.id, me, round_no, round(least(greatest(value, 0), 100), 1))
    on conflict (room_id, user_id, round) do update set guess = excluded.guess, created_at = now();
  update public.room_players set last_seen = now() where room_id = r.id and user_id = me;
end $$;

-- room_tick: guessing games start 3 s after the go (every phone gets ready)
-- and finish when the last round's reveal ends; nobody is eliminated.
create or replace function public.room_tick(room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
  n integer;
begin
  select * into r from public.rooms where id = room_id for update;
  if not found then return; end if;
  if r.status = 'lobby' then
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
      update public.rooms set status = 'playing',
          started_at = now() + case when mode = 'guess' then interval '3 seconds' else interval '0 seconds' end
        where id = r.id and starts_at is not null and starts_at <= now() and n >= 2;
      if found then update public.room_players p set last_seen = now() where p.room_id = r.id; end if;
    end if;
  elsif r.status = 'playing' and r.mode = 'guess' then
    if now() >= r.started_at + make_interval(secs => r.rounds * (r.round_seconds + r.reveal_seconds)) then
      update public.rooms set status = 'finished' where id = r.id;
    end if;
  elsif r.status = 'playing' then
    update public.room_players p set alive = false, finished_at = coalesce(p.finished_at, now())
      where p.room_id = r.id and p.alive and p.last_seen < now() - interval '25 seconds';
    if not exists (select 1 from public.room_players p where p.room_id = r.id and p.alive) then
      update public.rooms set status = 'finished' where id = r.id;
    end if;
  end if;
end $$;

create or replace function public.start_room(room_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
begin
  update public.rooms set status = 'playing',
      started_at = now() + case when mode = 'guess' then interval '3 seconds' else interval '0 seconds' end
    where code = upper(room_code) and host_id = auth.uid() and status = 'lobby' and not is_public
    returning id into rid;
  if rid is null then raise exception 'Only the host can start this room'; end if;
  update public.room_players set last_seen = now() where room_id = rid;
end $$;

-- Private room with a game mode ('standing' = last one standing, 'guess' = closest guess).
create function public.create_room(room_category text, room_mode text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  new_code text;
  room uuid;
begin
  if me is null then raise exception 'Sign in to create a room'; end if;
  if room_category is not null and room_category !~ '^[a-z]{3,12}$' then raise exception 'Unknown category'; end if;
  if room_mode not in ('standing', 'guess') then raise exception 'Unknown game mode'; end if;
  loop
    new_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.rooms where code = new_code);
  end loop;
  insert into public.rooms (code, host_id, seed, category, mode)
    values (new_code, me, floor(random() * 2147483647)::bigint, room_category, room_mode)
    returning id into room;
  insert into public.room_players (room_id, user_id, username)
    select room, me, username from public.profiles where id = me;
  return new_code;
end $$;

-- Public game of the chosen mode with strangers.
create function public.quick_match(room_mode text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rooms;
  new_code text;
  old record;
begin
  if me is null then raise exception 'Sign in to play online'; end if;
  if room_mode not in ('standing', 'guess') then raise exception 'Unknown game mode'; end if;
  select ro.* into r from public.rooms ro join public.room_players p on p.room_id = ro.id and p.user_id = me
    where ro.is_public and ro.status = 'lobby' and ro.mode = room_mode limit 1;
  if found then
    update public.room_players set last_seen = now() where room_id = r.id and user_id = me;
    return r.code;
  end if;
  for old in select id from public.rooms where is_public and status = 'lobby' loop
    perform public.room_tick(old.id);
  end loop;
  select * into r from public.rooms ro
    where ro.is_public and ro.status = 'lobby' and ro.mode = room_mode
      and (select count(*) from public.room_players p where p.room_id = ro.id) < 10
    order by ro.created_at limit 1 for update skip locked;
  if not found then
    loop
      new_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
      exit when not exists (select 1 from public.rooms where code = new_code);
    end loop;
    insert into public.rooms (code, host_id, seed, is_public, mode)
      values (new_code, me, floor(random() * 2147483647)::bigint, true, room_mode)
      returning * into r;
  end if;
  insert into public.room_players (room_id, user_id, username)
    select r.id, me, username from public.profiles where id = me;
  perform public.room_tick(r.id);
  return r.code;
end $$;

create or replace function public.quick_match() returns text
language sql security definer set search_path = '' as $$ select public.quick_match('standing') $$;

revoke execute on function public.submit_guess(text, integer, numeric), public.create_room(text, text),
  public.quick_match(text) from public, anon;
grant execute on function public.submit_guess(text, integer, numeric), public.create_room(text, text),
  public.quick_match(text) to authenticated;
