-- RETRO BOXING - the Sunday tournament, run to a timetable
--
-- Quarter finals 19:00, semi finals 19:30, final 20:00, Sydney time.
-- Marking in opens ten minutes before each round and closes when it starts.
-- Whoever has not marked in by then loses the bout on a walkover.
--
-- Run after tournament.sql. Safe to run more than once.

-- ------------------------------------------------------- when a round boxes
create or replace function public.round_time(p_starts timestamptz, p_round smallint)
returns timestamptz language sql immutable as $$
  select p_starts + ((p_round - 1) * interval '30 minutes');
$$;

-- ------------------------------------------------ marking in, once a round
alter table public.tourney_checkin add column if not exists round smallint not null default 1;

do $$
begin
  if exists (select 1 from pg_constraint
              where conname = 'tourney_checkin_pkey'
                and conrelid = 'public.tourney_checkin'::regclass) then
    alter table public.tourney_checkin drop constraint tourney_checkin_pkey;
  end if;
end $$;

alter table public.tourney_checkin add primary key (tourney, fighter, round);

drop function if exists public.check_in(uuid, uuid);
create or replace function public.check_in(p_tourney uuid, p_fighter uuid, p_round smallint)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  rt timestamptz;
begin
  select * into t from public.tournaments where id = p_tourney;
  if t.id is null then raise exception 'NO SUCH TOURNAMENT'; end if;

  if not exists (select 1 from public.fighters f
                 where f.id = p_fighter and f.owner = auth.uid()) then
    raise exception 'THAT IS NOT YOUR FIGHTER';
  end if;
  if not exists (select 1 from public.tourney_bouts b
                 where b.tourney = p_tourney and b.round = p_round
                   and (b.red = p_fighter or b.blue = p_fighter)) then
    raise exception 'YOU ARE NOT IN THAT ROUND';
  end if;

  rt := public.round_time(t.starts_at, p_round);
  if now() < rt - interval '10 minutes' then
    raise exception 'MARKING IN OPENS TEN MINUTES BEFORE';
  end if;
  if now() >= rt then
    raise exception 'TOO LATE - THAT ROUND HAS STARTED';
  end if;

  insert into public.tourney_checkin (tourney, fighter, round)
  values (p_tourney, p_fighter, p_round)
  on conflict do nothing;
end $$;

-- ------------------------------------------- walkovers, round by round
-- Idempotent: safe to call from any client, as often as it likes.
create or replace function public.settle_tournament(p_tourney uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  b public.tourney_bouts;
  redin boolean; bluein boolean;
begin
  select * into t from public.tournaments where id = p_tourney;
  if t.id is null or t.status = 'done' then return; end if;

  if now() >= t.starts_at then
    update public.tournaments set status = 'live' where id = p_tourney and status = 'open';
  end if;

  for r in 1..3 loop
    -- last round's winners take their places in this one
    if r > 1 then
      for b in select * from public.tourney_bouts
                where tourney = p_tourney and round = r - 1 and winner is not null loop
        if (b.slot % 2) = 0 then
          update public.tourney_bouts set red = b.winner
           where tourney = p_tourney and round = r and slot = b.slot / 2 and red is null;
        else
          update public.tourney_bouts set blue = b.winner
           where tourney = p_tourney and round = r and slot = b.slot / 2 and blue is null;
        end if;
      end loop;
    end if;

    -- at the appointed hour, whoever has not marked in is not fighting
    if now() >= public.round_time(t.starts_at, r::smallint) then
      for b in select * from public.tourney_bouts
                where tourney = p_tourney and round = r and winner is null loop
        redin  := b.red is not null and exists (
                    select 1 from public.tourney_checkin c
                     where c.tourney = p_tourney and c.fighter = b.red and c.round = r);
        bluein := b.blue is not null and exists (
                    select 1 from public.tourney_checkin c
                     where c.tourney = p_tourney and c.fighter = b.blue and c.round = r);
        if redin and bluein then
          null;                                   -- both here: let them box
        elsif redin then
          update public.tourney_bouts set winner = b.red, walkover = true where id = b.id;
        elsif bluein then
          update public.tourney_bouts set winner = b.blue, walkover = true where id = b.id;
        else
          update public.tourney_bouts set walkover = true where id = b.id;
        end if;
      end loop;
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

grant execute on function public.round_time(timestamptz, smallint) to anon, authenticated;
grant execute on function public.check_in(uuid, uuid, smallint) to authenticated;
grant execute on function public.settle_tournament(uuid) to authenticated;
