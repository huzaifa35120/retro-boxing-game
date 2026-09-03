-- RETRO BOXING - the Sunday tournament
-- Eight fighters, single elimination, 7pm Sunday Sydney time.
-- Winner is champion for the week.
-- Run after titles.sql.

create table if not exists public.tournaments (
  id        uuid primary key default gen_random_uuid(),
  division  smallint not null,
  starts_at timestamptz not null,
  status    text not null default 'open'
              check (status in ('open','live','done')),
  winner    uuid references public.fighters on delete set null,
  unique (division, starts_at)
);

create table if not exists public.tourney_bouts (
  id       uuid primary key default gen_random_uuid(),
  tourney  uuid not null references public.tournaments on delete cascade,
  round    smallint not null,          -- 1 quarters, 2 semis, 3 final
  slot     smallint not null,          -- position within the round
  red      uuid references public.fighters on delete set null,
  blue     uuid references public.fighters on delete set null,
  winner   uuid references public.fighters on delete set null,
  room     uuid references public.rooms on delete set null,
  walkover boolean not null default false,
  unique (tourney, round, slot)
);

-- who has turned up
create table if not exists public.tourney_checkin (
  tourney uuid not null references public.tournaments on delete cascade,
  fighter uuid not null references public.fighters on delete cascade,
  at      timestamptz not null default now(),
  primary key (tourney, fighter)
);

alter table public.tournaments     enable row level security;
alter table public.tourney_bouts   enable row level security;
alter table public.tourney_checkin enable row level security;

drop policy if exists "tournaments are public" on public.tournaments;
create policy "tournaments are public" on public.tournaments for select using (true);
drop policy if exists "bouts are public" on public.tourney_bouts;
create policy "bouts are public" on public.tourney_bouts for select using (true);
drop policy if exists "checkins are public" on public.tourney_checkin;
create policy "checkins are public" on public.tourney_checkin for select using (true);

-- --------------------------------------------------- next Sunday, 7pm Sydney
create or replace function public.next_fight_night()
returns timestamptz language sql stable as $$
  select ((date_trunc('week', (now() at time zone 'Australia/Sydney'))
           + interval '6 days 19 hours')
          + case when (now() at time zone 'Australia/Sydney')
                      > (date_trunc('week', (now() at time zone 'Australia/Sydney'))
                         + interval '6 days 19 hours')
                 then interval '7 days' else interval '0' end
         ) at time zone 'Australia/Sydney';
$$;

-- ------------------------------------------------------------ open the draw
-- Seeds the top 8: 1v8, 4v5, 2v7, 3v6, so the top two can only meet in the final.
create or replace function public.open_tournament(p_division smallint)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  ids uuid[];
  night timestamptz := public.next_fight_night();
begin
  select id into t from public.tournaments
   where division = p_division and starts_at = night;
  if t is not null then return t; end if;

  select array_agg(c.id order by c.win_pct desc, c.bouts desc)
    into ids from public.contenders(p_division) c;
  if ids is null or array_length(ids, 1) < 2 then return null; end if;

  insert into public.tournaments (division, starts_at) values (p_division, night)
  returning id into t;

  -- eight slots; missing seeds are simply empty and give a walkover
  insert into public.tourney_bouts (tourney, round, slot, red, blue) values
    (t, 1, 0, ids[1], ids[8]),
    (t, 1, 1, ids[4], ids[5]),
    (t, 1, 2, ids[2], ids[7]),
    (t, 1, 3, ids[3], ids[6]),
    (t, 2, 0, null, null),
    (t, 2, 1, null, null),
    (t, 3, 0, null, null);
  return t;
end $$;

-- ---------------------------------------------------------------- check in
create or replace function public.check_in(p_tourney uuid, p_fighter uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.fighters f
                 where f.id = p_fighter and f.owner = auth.uid()) then
    raise exception 'THAT IS NOT YOUR FIGHTER';
  end if;
  if not exists (select 1 from public.tourney_bouts b
                 where b.tourney = p_tourney
                   and (b.red = p_fighter or b.blue = p_fighter)) then
    raise exception 'YOU ARE NOT IN THIS DRAW';
  end if;
  insert into public.tourney_checkin (tourney, fighter) values (p_tourney, p_fighter)
    on conflict do nothing;
end $$;

-- ------------------------------------------------- walkovers and advancing
-- Anyone not checked in five minutes before the start forfeits. Run this at
-- the start, and again after every result.
create or replace function public.settle_tournament(p_tourney uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  b public.tourney_bouts;
  redin boolean; bluein boolean;
begin
  select * into t from public.tournaments where id = p_tourney;
  if t.id is null or t.status = 'done' then return; end if;

  -- no-shows, once the doors have closed
  if now() >= t.starts_at - interval '5 minutes' then
    for b in select * from public.tourney_bouts
              where tourney = p_tourney and winner is null and round = 1 loop
      redin  := b.red  is not null and exists (select 1 from public.tourney_checkin c
                                               where c.tourney = p_tourney and c.fighter = b.red);
      bluein := b.blue is not null and exists (select 1 from public.tourney_checkin c
                                               where c.tourney = p_tourney and c.fighter = b.blue);
      if redin and not bluein then
        update public.tourney_bouts set winner = b.red, walkover = true where id = b.id;
      elsif bluein and not redin then
        update public.tourney_bouts set winner = b.blue, walkover = true where id = b.id;
      elsif not redin and not bluein then
        update public.tourney_bouts set winner = null, walkover = true where id = b.id;
      end if;
    end loop;
    update public.tournaments set status = 'live' where id = p_tourney and status = 'open';
  end if;

  -- carry winners into the next round
  for b in select * from public.tourney_bouts
            where tourney = p_tourney and winner is not null and round < 3 loop
    if b.round = 1 then
      if b.slot in (0, 1) then
        update public.tourney_bouts set red = case when b.slot = 0 then b.winner else red end,
                                        blue = case when b.slot = 1 then b.winner else blue end
         where tourney = p_tourney and round = 2 and slot = 0;
      else
        update public.tourney_bouts set red = case when b.slot = 2 then b.winner else red end,
                                        blue = case when b.slot = 3 then b.winner else blue end
         where tourney = p_tourney and round = 2 and slot = 1;
      end if;
    elsif b.round = 2 then
      update public.tourney_bouts set red = case when b.slot = 0 then b.winner else red end,
                                      blue = case when b.slot = 1 then b.winner else blue end
       where tourney = p_tourney and round = 3 and slot = 0;
    end if;
  end loop;

  -- the final decides the belt
  select * into b from public.tourney_bouts
   where tourney = p_tourney and round = 3 and winner is not null;
  if b.id is not null then
    update public.tournaments set status = 'done', winner = b.winner where id = p_tourney;
    insert into public.champions (division, fighter, since, won_at)
    values (t.division, b.winner, now(), t.starts_at)
    on conflict (division) do update
      set fighter = excluded.fighter, since = now(), won_at = excluded.won_at;
  end if;
end $$;

grant execute on function public.next_fight_night() to anon, authenticated;
grant execute on function public.open_tournament(smallint) to authenticated;
grant execute on function public.check_in(uuid, uuid) to authenticated;
grant execute on function public.settle_tournament(uuid) to authenticated;
