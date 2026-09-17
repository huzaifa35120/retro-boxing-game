-- RETRO BOXING - take the tournament and the belt back out
--
-- The Sunday draw, the check-ins and the champion are gone. What is left is
-- the ranking: every player fight still counts towards it, and the board is
-- a hundred deep instead of ten.
--
-- Run this once, after tournament-rounds.sql. Safe to run more than once.

-- ------------------------------------------- results, with nothing to advance
-- Same as before minus the draw: record the fight, move the two records, and
-- close the room.
create or replace function public.report_match(
  p_room uuid, p_winner uuid, p_method text, p_rounds jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  ko boolean;
begin
  select * into r from public.rooms where id = p_room;
  if r.id is null or r.status = 'done' then return; end if;
  if auth.uid() <> r.host and auth.uid() <> r.guest then
    raise exception 'THAT WAS NOT YOUR FIGHT';
  end if;
  if p_winner is not null and p_winner <> r.host_fighter and p_winner <> r.guest_fighter then
    raise exception 'THAT FIGHTER WAS NOT IN THIS FIGHT';
  end if;

  ko := p_method in ('ko', 'tko');

  insert into public.matches (division, red, blue, winner, method, rounds, is_title)
  values (r.division, r.host_fighter, r.guest_fighter, p_winner, p_method, p_rounds, false);

  if p_winner is null then
    update public.fighters set draws = draws + 1
      where id in (r.host_fighter, r.guest_fighter);
  else
    update public.fighters
       set wins = wins + 1, ko_for = ko_for + (case when ko then 1 else 0 end)
     where id = p_winner;
    update public.fighters
       set losses = losses + 1, ko_against = ko_against + (case when ko then 1 else 0 end)
     where id in (r.host_fighter, r.guest_fighter) and id <> p_winner;
  end if;

  update public.rooms set status = 'done' where id = r.id;
end $$;

-- ------------------------------------------------- a room is only ever a room
create or replace function public.create_room(p_division smallint, p_fighter uuid)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  c text;
begin
  perform public.sweep_rooms();
  delete from public.rooms
   where host = auth.uid() and status in ('open', 'full');

  loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from public.rooms where code = c);
  end loop;

  insert into public.rooms (code, host, host_fighter, division, status)
  values (c, auth.uid(), p_fighter, p_division, 'open')
  returning * into r;
  return r;
end $$;

-- ------------------------------------------------------------- and out it all goes
drop function if exists public.start_bout(uuid);
drop function if exists public.check_in(uuid, uuid, smallint);
drop function if exists public.check_in(uuid, uuid);
drop function if exists public.settle_tournament(uuid);
drop function if exists public.open_tournament(smallint);
drop function if exists public.round_time(timestamptz, smallint);
drop function if exists public.next_fight_night();

alter table public.rooms drop column if exists bout;

drop view if exists public.champions_view;
drop table if exists public.tourney_checkin cascade;
drop table if exists public.tourney_bouts cascade;
drop table if exists public.tournaments cascade;
drop table if exists public.champions cascade;

grant execute on function public.report_match(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.create_room(smallint, uuid) to authenticated;
