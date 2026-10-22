-- What everybody answered (shown after each reveal) and how today's dailies
-- went (score distribution). Anyone may add their own answer, guests included;
-- the functions only ever increment counters.

create table public.answer_stats (
  key text primary key check (char_length(key) <= 200),
  kind text not null check (kind in ('pair', 'guess')),
  plays integer not null default 0,
  hits integer not null default 0,
  guess_sum double precision not null default 0,
  miss_sum double precision not null default 0
);
alter table public.answer_stats enable row level security;
create policy "answer stats are public" on public.answer_stats for select to anon, authenticated using (true);

create table public.daily_counts (
  day date not null,
  game text not null check (game in ('pairs', 'guess')),
  score smallint not null check (score between 0 and 500),
  players integer not null default 0,
  primary key (day, game, score)
);
alter table public.daily_counts enable row level security;
create policy "daily counts are public" on public.daily_counts for select to anon, authenticated using (true);

-- Higher or lower: key is "idA|idB" with the ids sorted.
create function public.record_pair(pair_key text, correct boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if pair_key !~ '^[a-z0-9-]{1,90}\|[a-z0-9-]{1,90}$' then raise exception 'Bad pair key'; end if;
  insert into public.answer_stats (key, kind, plays, hits) values (pair_key, 'pair', 1, correct::int)
    on conflict (key) do update set plays = public.answer_stats.plays + 1, hits = public.answer_stats.hits + excluded.hits;
end $$;

-- Closest guess: the guess and how far it was from the real value.
create function public.record_guess(card_id text, guess numeric, miss numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if card_id !~ '^[a-z0-9-]{1,90}$' then raise exception 'Bad card id'; end if;
  if guess < 0 or guess > 100 or miss < 0 or miss > 100 then raise exception 'Out of range'; end if;
  insert into public.answer_stats (key, kind, plays, guess_sum, miss_sum) values (card_id, 'guess', 1, guess, miss)
    on conflict (key) do update set plays = public.answer_stats.plays + 1,
      guess_sum = public.answer_stats.guess_sum + excluded.guess_sum, miss_sum = public.answer_stats.miss_sum + excluded.miss_sum;
end $$;

-- Only today's dailies (a day either side covers every time zone).
create function public.record_daily(day date, game text, score integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if record_daily.day < current_date - 1 or record_daily.day > current_date + 1 then raise exception 'Only today''s challenge counts'; end if;
  if record_daily.game not in ('pairs', 'guess')
    or (record_daily.game = 'pairs' and record_daily.score not between 0 and 10)
    or (record_daily.game = 'guess' and record_daily.score not between 0 and 500) then
    raise exception 'Bad score';
  end if;
  insert into public.daily_counts as d (day, game, score, players)
    values (record_daily.day, record_daily.game, record_daily.score, 1)
    on conflict on constraint daily_counts_pkey do update set players = d.players + 1;
end $$;

revoke execute on function public.record_pair(text, boolean), public.record_guess(text, numeric, numeric), public.record_daily(date, text, integer) from public;
grant execute on function public.record_pair(text, boolean), public.record_guess(text, numeric, numeric), public.record_daily(date, text, integer) to anon, authenticated;
