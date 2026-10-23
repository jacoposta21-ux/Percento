-- All four games online. 'match' (match the card) and 'odd' (odd one out)
-- play like 'standing': same seeded questions for everyone, one mistake and
-- you are out, report_room_score keeps the standings. Public games can also
-- be per category now.
alter table public.rooms drop constraint rooms_mode_check;
alter table public.rooms add constraint rooms_mode_check check (mode in ('standing', 'guess', 'match', 'odd'));

create or replace function public.create_room(room_category text, room_mode text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  new_code text;
  room uuid;
begin
  if me is null then raise exception 'Sign in to create a room'; end if;
  if room_category is not null and room_category !~ '^[a-z]{3,12}$' then raise exception 'Unknown category'; end if;
  if room_mode not in ('standing', 'guess', 'match', 'odd') then raise exception 'Unknown game mode'; end if;
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

-- Public game of the chosen mode (and category, null = mixed) with strangers.
create function public.quick_match(room_mode text, room_category text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rooms;
  new_code text;
  old record;
begin
  if me is null then raise exception 'Sign in to play online'; end if;
  if room_mode not in ('standing', 'guess', 'match', 'odd') then raise exception 'Unknown game mode'; end if;
  if room_category is not null and room_category !~ '^[a-z]{3,12}$' then raise exception 'Unknown category'; end if;
  select ro.* into r from public.rooms ro join public.room_players p on p.room_id = ro.id and p.user_id = me
    where ro.is_public and ro.status = 'lobby' and ro.mode = room_mode and ro.category is not distinct from room_category limit 1;
  if found then
    update public.room_players set last_seen = now() where room_id = r.id and user_id = me;
    return r.code;
  end if;
  for old in select id from public.rooms where is_public and status = 'lobby' loop
    perform public.room_tick(old.id);
  end loop;
  select * into r from public.rooms ro
    where ro.is_public and ro.status = 'lobby' and ro.mode = room_mode and ro.category is not distinct from room_category
      and (select count(*) from public.room_players p where p.room_id = ro.id) < 10
    order by ro.created_at limit 1 for update skip locked;
  if not found then
    loop
      new_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
      exit when not exists (select 1 from public.rooms where code = new_code);
    end loop;
    insert into public.rooms (code, host_id, seed, is_public, mode, category)
      values (new_code, me, floor(random() * 2147483647)::bigint, true, room_mode, room_category)
      returning * into r;
  end if;
  insert into public.room_players (room_id, user_id, username)
    select r.id, me, username from public.profiles where id = me;
  perform public.room_tick(r.id);
  return r.code;
end $$;

-- The one-argument version keeps working for clients that are still loaded.
create or replace function public.quick_match(room_mode text) returns text
language sql security definer set search_path = '' as $$ select public.quick_match(room_mode, null) $$;

revoke execute on function public.quick_match(text, text) from public, anon;
grant execute on function public.quick_match(text, text) to authenticated;
