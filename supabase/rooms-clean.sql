-- FIX: closing a room only marked it 'done', so every room ever opened stayed
-- in the table. Closed rooms are now deleted, and the leftovers are cleared.
-- Run after matchmaking.sql. Replaces rooms-tidy.sql.

-- a player may delete a room he is in
drop policy if exists "leave own room" on public.rooms;
create policy "leave own room" on public.rooms
  for delete using (auth.uid() = host or auth.uid() = guest);

-- housekeeping, called whenever anybody opens or looks for a fight
create or replace function public.sweep_rooms()
returns void language sql security definer set search_path = public as $$
  delete from public.rooms
   where (status = 'done'  and created_at < now() - interval '10 minutes')
      or (status <> 'done' and created_at < now() - interval '1 hour');
$$;

create or replace function public.create_room(p_division smallint, p_fighter uuid)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  c text;
  tries int := 0;
begin
  if not exists (select 1 from public.fighters f
                 where f.id = p_fighter and f.owner = auth.uid()) then
    raise exception 'THAT IS NOT YOUR FIGHTER';
  end if;

  perform public.sweep_rooms();

  -- you only ever have one room open, and the old one goes away
  delete from public.rooms
   where host = auth.uid() and status in ('open', 'full') and bout is null;

  loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    c := translate(c, 'AEIOU', 'XYZWQ');
    exit when not exists (select 1 from public.rooms where code = c);
    tries := tries + 1;
    if tries > 20 then raise exception 'COULD NOT MAKE A ROOM CODE'; end if;
  end loop;

  insert into public.rooms (code, host, host_fighter, division, status)
  values (c, auth.uid(), p_fighter, p_division, 'open')
  returning * into r;
  return r;
end $$;

-- reporting twice is normal - both players do it. If the room has already
-- gone, there is nothing left to do rather than an error to raise.
create or replace function public.report_match(
  p_room uuid, p_winner uuid, p_method text, p_rounds jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  b public.tourney_bouts;
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
  values (r.division, r.host_fighter, r.guest_fighter, p_winner, p_method, p_rounds,
          r.bout is not null);

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

  if r.bout is not null then
    select * into b from public.tourney_bouts where id = r.bout;
    update public.tourney_bouts set winner = coalesce(p_winner, b.red) where id = r.bout;
    perform public.settle_tournament(b.tourney);
  end if;

  -- keep it briefly so the other player's report is a clean no-op, then sweep
  update public.rooms set status = 'done' where id = r.id;
end $$;

grant execute on function public.sweep_rooms() to authenticated;
grant execute on function public.create_room(smallint, uuid) to authenticated;
grant execute on function public.report_match(uuid, uuid, text, jsonb) to authenticated;

-- clear out everything already sitting there
delete from public.rooms where status = 'done';
