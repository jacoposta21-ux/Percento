-- Players, solo results and multiplayer rooms for PERCENTO.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null check (char_length(username) between 3 and 20 and username ~ '^[A-Za-z0-9_]+$'),
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

create table public.runs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  score integer not null check (score between 0 and 1000),
  created_at timestamptz not null default now()
);
create index runs_user on public.runs (user_id, score desc);
create index runs_score on public.runs (score desc);

create table public.daily_results (
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  day date not null,
  answers boolean[] not null check (cardinality(answers) <= 10),
  score smallint not null check (score between 0 and 10),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index daily_day on public.daily_results (day, score desc);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references public.profiles on delete cascade,
  seed bigint not null,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  created_at timestamptz not null default now(),
  started_at timestamptz
);

create table public.room_players (
  room_id uuid not null references public.rooms on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  username text not null,
  score integer not null default 0 check (score between 0 and 1000),
  alive boolean not null default true,
  finished_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_players_user on public.room_players (user_id);

-- Profile on sign-up: requested username, else Google name, else email name; made unique.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  base text;
  candidate text;
begin
  base := regexp_replace(coalesce(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'full_name',
    split_part(new.email, '@', 1), 'player'), '[^A-Za-z0-9_]', '', 'g');
  if char_length(base) < 3 then base := base || 'player'; end if;
  base := left(base, 15);
  candidate := base;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    candidate := base || (floor(random() * 90000) + 10000)::int::text;
  end loop;
  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rooms: created, joined and started only through these functions.
create function public.create_room() returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  new_code text;
  room uuid;
begin
  if me is null then raise exception 'Sign in to create a room'; end if;
  loop
    new_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.rooms where code = new_code);
  end loop;
  insert into public.rooms (code, host_id, seed) values (new_code, me, floor(random() * 2147483647)::bigint)
    returning id into room;
  insert into public.room_players (room_id, user_id, username)
    select room, me, username from public.profiles where id = me;
  return new_code;
end $$;

create function public.join_room(room_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rooms;
begin
  if me is null then raise exception 'Sign in to join a room'; end if;
  select * into r from public.rooms where code = upper(room_code) for update;
  if not found then raise exception 'Room not found'; end if;
  if exists (select 1 from public.room_players where room_id = r.id and user_id = me) then return r.id; end if;
  if r.status <> 'lobby' then raise exception 'This game has already started'; end if;
  if (select count(*) from public.room_players where room_id = r.id) >= 10 then raise exception 'Room is full (10 players)'; end if;
  insert into public.room_players (room_id, user_id, username)
    select r.id, me, username from public.profiles where id = me;
  return r.id;
end $$;

create function public.start_room(room_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.rooms set status = 'playing', started_at = now()
    where code = upper(room_code) and host_id = auth.uid() and status = 'lobby';
  if not found then raise exception 'Only the host can start this room'; end if;
end $$;

-- A player reports progress; the room ends when nobody is left playing.
create function public.report_room_score(room_code text, new_score integer, still_alive boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where code = upper(room_code) for update;
  if not found or r.status <> 'playing' then return; end if;
  update public.room_players
    set score = greatest(score, least(new_score, 1000)),
        alive = alive and still_alive,
        finished_at = case when still_alive then finished_at else coalesce(finished_at, now()) end
    where room_id = r.id and user_id = auth.uid() and alive;
  if not exists (select 1 from public.room_players where room_id = r.id and alive) then
    update public.rooms set status = 'finished' where id = r.id;
  end if;
end $$;

revoke execute on function public.create_room(), public.join_room(text), public.start_room(text),
  public.report_room_score(text, integer, boolean) from public, anon;
grant execute on function public.create_room(), public.join_room(text), public.start_room(text),
  public.report_room_score(text, integer, boolean) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Row level security.
alter table public.profiles enable row level security;
alter table public.runs enable row level security;
alter table public.daily_results enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;

create policy "profiles are public" on public.profiles for select to anon, authenticated using (true);
create policy "rename yourself" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "runs are public" on public.runs for select to anon, authenticated using (true);
create policy "record your runs" on public.runs for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "daily results are public" on public.daily_results for select to anon, authenticated using (true);
create policy "record your daily" on public.daily_results for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "continue your daily" on public.daily_results for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "rooms visible to players" on public.rooms for select to authenticated using (true);
create policy "room players visible" on public.room_players for select to authenticated using (true);
create policy "leave a room" on public.room_players for delete to authenticated using ((select auth.uid()) = user_id);

-- Leaderboard: best endless run per player.
create view public.leaderboard with (security_invoker = true) as
  select p.username, max(r.score) as best, count(*) as runs
  from public.runs r join public.profiles p on p.id = r.user_id
  group by p.username;

alter publication supabase_realtime add table public.rooms, public.room_players;

create index rooms_host on public.rooms (host_id);
