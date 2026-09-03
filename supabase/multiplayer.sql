-- RETRO BOXING - online fights
-- Run this after schema.sql (and after fix-handle.sql).

-- Where two browsers swap "here's how to reach me" while they connect.
-- Rows are short-lived: once the direct connection is up, nothing else uses them.
create table if not exists public.signals (
  id         bigserial primary key,
  room       uuid not null references public.rooms on delete cascade,
  sender     uuid not null,
  kind       text not null check (kind in ('offer','answer','ice')),
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists signals_room_idx on public.signals (room, id);

alter table public.signals enable row level security;

drop policy if exists "room members read signals" on public.signals;
create policy "room members read signals" on public.signals for select using (
  exists (select 1 from public.rooms r
          where r.id = signals.room and (r.host = auth.uid() or r.guest = auth.uid()))
);

drop policy if exists "room members write signals" on public.signals;
create policy "room members write signals" on public.signals for insert with check (
  sender = auth.uid() and
  exists (select 1 from public.rooms r
          where r.id = signals.room and (r.host = auth.uid() or r.guest = auth.uid()))
);

-- ------------------------------------------------------------ open a room
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
  loop
    -- 4 characters, no vowels, so no room code spells anything
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    c := translate(c, 'AEIOU', 'XYZWQ');
    exit when not exists (select 1 from public.rooms where code = c and status <> 'done');
    tries := tries + 1;
    if tries > 20 then raise exception 'COULD NOT MAKE A ROOM CODE'; end if;
  end loop;

  insert into public.rooms (code, host, host_fighter, division, status)
  values (c, auth.uid(), p_fighter, p_division, 'open')
  returning * into r;
  return r;
end $$;

-- ------------------------------------------------------------ join a room
create or replace function public.join_room(p_code text, p_fighter uuid)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  if not exists (select 1 from public.fighters f
                 where f.id = p_fighter and f.owner = auth.uid()) then
    raise exception 'THAT IS NOT YOUR FIGHTER';
  end if;

  update public.rooms
     set guest = auth.uid(), guest_fighter = p_fighter, status = 'full'
   where code = upper(p_code)
     and status = 'open'
     and division = (select division from public.fighters where id = p_fighter)
  returning * into r;

  if r.id is null then
    raise exception 'NO OPEN ROOM WITH THAT CODE IN YOUR DIVISION';
  end if;
  return r;
end $$;

-- ------------------------------------------------------- report the result
-- The only thing in the system that may touch a fighter's official record.
create or replace function public.report_match(
  p_room uuid, p_winner uuid, p_method text, p_rounds jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  ko boolean;
begin
  select * into r from public.rooms where id = p_room;
  if r.id is null then raise exception 'NO SUCH ROOM'; end if;
  if auth.uid() <> r.host and auth.uid() <> r.guest then
    raise exception 'THAT WAS NOT YOUR FIGHT';
  end if;
  if r.status = 'done' then return; end if;          -- already reported
  if p_winner is not null and p_winner <> r.host_fighter and p_winner <> r.guest_fighter then
    raise exception 'THAT FIGHTER WAS NOT IN THIS FIGHT';
  end if;

  ko := p_method in ('ko', 'tko');

  insert into public.matches (division, red, blue, winner, method, rounds)
  values (r.division, r.host_fighter, r.guest_fighter, p_winner, p_method, p_rounds);

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

grant execute on function public.create_room(smallint, uuid) to authenticated;
grant execute on function public.join_room(text, uuid) to authenticated;
grant execute on function public.report_match(uuid, uuid, text, jsonb) to authenticated;
