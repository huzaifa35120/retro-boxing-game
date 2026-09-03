-- RETRO BOXING - rankings and the belt
-- Run after schema.sql, multiplayer.sql and usernames.sql.

-- One champion per division. He holds it for a week, until the next
-- tournament produces a new one.
create table if not exists public.champions (
  division  smallint primary key,
  fighter   uuid references public.fighters on delete set null,
  since     timestamptz not null default now(),
  won_at    timestamptz                       -- the tournament he won
);

alter table public.champions enable row level security;
drop policy if exists "champions are public" on public.champions;
create policy "champions are public" on public.champions for select using (true);

-- Everyone with a bout, best win percentage first. The champion is listed
-- above the rankings, not among them.
create or replace function public.contenders(p_division smallint)
returns table (id uuid, name text, win_pct int, bouts int) language sql stable as $$
  select f.id, f.name,
         round(100.0 * f.wins / (f.wins + f.losses + f.draws))::int,
         (f.wins + f.losses + f.draws)
  from public.fighters f
  where f.division = p_division
    and (f.wins + f.losses + f.draws) > 0
  order by 3 desc, f.wins desc, f.created_at asc
  limit 10;
$$;

create or replace view public.champions_view as
  select c.division, c.since, c.won_at,
         f.id, f.name, f.country, f.skin, f.shorts,
         f.wins, f.losses, f.draws, f.ko_for,
         (f.wins + f.losses + f.draws) as bouts,
         case when (f.wins + f.losses + f.draws) = 0 then 0
              else round(100.0 * f.wins / (f.wins + f.losses + f.draws))::int end as win_pct,
         p.handle
  from public.champions c
  join public.fighters f on f.id = c.fighter
  join public.profiles p on p.id = f.owner;

grant select on public.champions_view to anon, authenticated;
grant execute on function public.contenders(smallint) to anon, authenticated;

-- the old card tables are not used any more
drop table if exists public.title_challenges cascade;
drop table if exists public.card_bouts cascade;
drop table if exists public.cards cascade;
