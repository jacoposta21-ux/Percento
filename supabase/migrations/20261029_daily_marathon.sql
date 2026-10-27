-- The CrazyGames daily: a "higher or lower" marathon, the same endless
-- sequence of pairs for everyone that day, over at the first miss. One go a
-- day; the board shows the day's best scores.
-- Scores only move through the two functions below: the run starts on the
-- server clock, each answer is sent the moment it is given (before the
-- reveal), a miss ends the run, and a right answer counts only if the run
-- has lasted long enough for it (1.2 s for each earlier pair: the reveal
-- alone takes longer).
create table public.marathon_results (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  score integer not null default 0 check (score between 0 and 2000),
  finished boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.marathon_results enable row level security;
create policy "marathon results are public" on public.marathon_results for select using (true);
create index marathon_results_board on public.marathon_results (day, score desc, updated_at);

-- Starts today's run, or returns the one already started.
create function public.marathon_start() returns public.marathon_results
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Europe/Rome')::date;
  r public.marathon_results;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.marathon_results (user_id, day) values (auth.uid(), today) on conflict do nothing;
  select * into r from public.marathon_results where user_id = auth.uid() and day = today;
  return r;
end $$;

-- One answer of today's run. Returns the run as it stands.
create function public.marathon_answer(right_answer boolean) returns public.marathon_results
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Europe/Rome')::date;
  r public.marathon_results;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into r from public.marathon_results where user_id = auth.uid() and day = today for update;
  if not found or r.finished then return r; end if;
  if right_answer and extract(epoch from now() - r.started_at) >= r.score * 1.2 then
    update public.marathon_results set score = score + 1, updated_at = now()
      where user_id = auth.uid() and day = today returning * into r;
  elsif not right_answer then
    update public.marathon_results set finished = true, updated_at = now()
      where user_id = auth.uid() and day = today returning * into r;
  end if;
  return r;
end $$;

revoke execute on function public.marathon_start() from public, anon;
revoke execute on function public.marathon_answer(boolean) from public, anon;
grant execute on function public.marathon_start() to authenticated;
grant execute on function public.marathon_answer(boolean) to authenticated;

-- The board of a day: best score first, the earlier finisher wins a tie.
create view public.marathon_board with (security_invoker = true) as
  select m.day, p.username, m.score, m.finished, m.updated_at
    from public.marathon_results m join public.profiles p on p.id = m.user_id
   where m.score > 0;
grant select on public.marathon_board to anon, authenticated;
