-- RETRO BOXING - casual matchmaking, tournament bouts, and reporting
-- Run after tournament.sql.

alter table public.rooms add column if not exists bout uuid
  references public.tourney_bouts on delete set null;
alter table public.rooms add column if not exists casual boolean not null default false;

-- ------------------------------------------------------- looking for a fight
create table if not exists public.casual_queue (
  fighter  uuid primary key references public.fighters on delete cascade,
  owner    uuid not null,
  division smallint not null,
  since    timestamptz not null default now()
);
alter table public.casual_queue enable row level security;
drop policy if exists "queue is public" on public.casual_queue;
create policy "queue is public" on public.casual_queue for select using (true);

-- Call this every couple of seconds while searching. It returns a room as
-- soon as somebody else in the same division is waiting, and otherwise puts
-- you in the queue and returns nothing.
create or replace function public.find_casual(p_fighter uuid)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  div smallint;
  opp public.casual_queue;
  r   public.rooms;
  c   text;
begin
  select f.division into div from public.fighters f
   where f.id = p_fighter and f.owner = auth.uid();
  if div is null then raise exception 'THAT IS NOT YOUR FIGHTER'; end if;

  -- has somebody already picked me up?
  select * into r from public.rooms
   where casual and status in ('open','full')
     and (host_fighter = p_fighter or guest_fighter = p_fighter)
     and guest is not null
     and created_at > now() - interval '3 minutes'
   order by created_at desc limit 1;
  if r.id is not null then
    delete from public.casual_queue where fighter = p_fighter;
    return r;
  end if;

  -- claim the longest waiting opponent, atomically
  delete from public.casual_queue q
   where q.fighter = (select q2.fighter from public.casual_queue q2
                       where q2.division = div and q2.owner <> auth.uid()
                       order by q2.since limit 1)
  returning * into opp;

  if opp.fighter is not null then
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    insert into public.rooms (code, host, host_fighter, guest, guest_fighter,
                              division, status, casual)
    values (c, opp.owner, opp.fighter, auth.uid(), p_fighter, div, 'full', true)
    returning * into r;
    delete from public.casual_queue where fighter = p_fighter;
    return r;
  end if;

  insert into public.casual_queue (fighter, owner, division)
  values (p_fighter, auth.uid(), div)
  on conflict (fighter) do update set since = now();
  return null;
end $$;

create or replace function public.leave_casual(p_fighter uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.casual_queue where fighter = p_fighter and owner = auth.uid();
$$;

-- --------------------------------------------------- a room for a draw bout
-- Both fighters call this and both get the same room.
create or replace function public.start_bout(p_bout uuid)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  b public.tourney_bouts;
  t public.tournaments;
  r public.rooms;
  c text;
  mine uuid;
begin
  select * into b from public.tourney_bouts where id = p_bout;
  if b.id is null then raise exception 'NO SUCH BOUT'; end if;
  if b.winner is not null then raise exception 'THAT BOUT IS OVER'; end if;
  if b.red is null or b.blue is null then raise exception 'THAT BOUT IS NOT SET'; end if;

  select f.id into mine from public.fighters f
   where f.owner = auth.uid() and f.id in (b.red, b.blue);
  if mine is null then raise exception 'YOU ARE NOT IN THAT BOUT'; end if;

  select * into r from public.rooms where id = b.room and status <> 'done';
  if r.id is not null then
    if r.guest is null and auth.uid() <> r.host then
      update public.rooms set guest = auth.uid(), guest_fighter = mine, status = 'full'
       where id = r.id returning * into r;
    end if;
    return r;
  end if;

  select * into t from public.tournaments where id = b.tourney;
  c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
  insert into public.rooms (code, host, host_fighter, division, status, bout)
  values (c, auth.uid(), mine, t.division, 'open', b.id)
  returning * into r;
  update public.tourney_bouts set room = r.id where id = b.id;
  return r;
end $$;

grant execute on function public.find_casual(uuid) to authenticated;
grant execute on function public.leave_casual(uuid) to authenticated;
grant execute on function public.start_bout(uuid) to authenticated;

-- ------------------------------------------------------------- the result
-- Records the fight, and if it was a tournament bout, advances the draw.
create or replace function public.report_match(
  p_room uuid, p_winner uuid, p_method text, p_rounds jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  b public.tourney_bouts;
  ko boolean;
begin
  select * into r from public.rooms where id = p_room;
  if r.id is null then raise exception 'NO SUCH ROOM'; end if;
  if auth.uid() <> r.host and auth.uid() <> r.guest then
    raise exception 'THAT WAS NOT YOUR FIGHT';
  end if;
  if r.status = 'done' then return; end if;
  if p_winner is not null and p_winner <> r.host_fighter and p_winner <> r.guest_fighter then
    raise exception 'THAT FIGHTER WAS NOT IN THIS FIGHT';
  end if;

  ko := p_method in ('ko', 'tko');

  insert into public.matches (division, red, blue, winner, method, rounds,
                              is_title, card_id)
  values (r.division, r.host_fighter, r.guest_fighter, p_winner, p_method, p_rounds,
          r.bout is not null, null);

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
    -- a draw in the draw goes to whoever is ranked higher, i.e. red
    update public.tourney_bouts
       set winner = coalesce(p_winner, b.red) where id = r.bout;
    perform public.settle_tournament(b.tourney);
  end if;

  update public.rooms set status = 'done' where id = r.id;
end $$;

grant execute on function public.report_match(uuid, uuid, text, jsonb) to authenticated;
