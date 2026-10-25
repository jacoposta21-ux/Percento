-- The world leaderboard now sums the daily challenges, the only games that
-- are the same for everyone: 10 points per right pair (up to 100) plus the
-- Closest guess points divided by 5 (up to 100), so at most 200 a day.
-- The server keeps the scores honest: only today's (or, around midnight,
-- yesterday's) row can be written, answers can only be added, never changed,
-- and the score is counted from the answers.
alter table public.daily_results alter column answers set default '{}';
alter table public.daily_results alter column score set default 0;
alter table public.daily_results add column guess_points smallint not null default 0 check (guess_points between 0 and 500);
alter table public.daily_results add column guess_cards smallint not null default 0 check (guess_cards between 0 and 5);

create function public.daily_results_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  today date := (now() at time zone 'Europe/Rome')::date;
begin
  if new.day not between today - 1 and today then raise exception 'Only today''s challenge can be saved'; end if;
  if tg_op = 'UPDATE' then
    if new.day <> old.day or new.user_id <> old.user_id then raise exception 'Not allowed'; end if;
    -- Pairs: earlier answers stay as they were.
    if cardinality(new.answers) < cardinality(old.answers) or new.answers[1:cardinality(old.answers)] is distinct from old.answers then
      new.answers := old.answers;
    end if;
    -- Closest guess: cards and points only go up.
    if new.guess_cards < old.guess_cards or new.guess_points < old.guess_points then
      new.guess_cards := old.guess_cards;
      new.guess_points := old.guess_points;
    end if;
  end if;
  new.score := (select count(*) from unnest(new.answers) a where a);
  if new.guess_points > 100 * new.guess_cards then new.guess_points := 100 * new.guess_cards; end if;
  return new;
end $$;

create trigger daily_results_guard before insert or update on public.daily_results
  for each row execute function public.daily_results_guard();

create view public.daily_leaderboard with (security_invoker = true) as
  select p.username,
         sum(d.score * 10 + round(d.guess_points / 5.0))::integer as points,
         count(*)::integer as days
    from public.daily_results d join public.profiles p on p.id = d.user_id
   group by p.username;
grant select on public.daily_leaderboard to anon, authenticated;

-- Players can delete their account and everything in it (profile, runs,
-- dailies and rooms cascade from the user).
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Advisor fix: pin the search path.
alter function public.server_time() set search_path = '';
