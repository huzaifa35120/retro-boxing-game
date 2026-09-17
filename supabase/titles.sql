-- RETRO BOXING - the rankings
-- Run after schema.sql, multiplayer.sql and usernames.sql.

-- Everyone with a bout behind him, best win percentage first. A hundred deep,
-- which is as far as the board will ever show.
create or replace function public.contenders(p_division smallint)
returns table (id uuid, name text, win_pct int, bouts int) language sql stable as $$
  select f.id, f.name,
         round(100.0 * f.wins / (f.wins + f.losses + f.draws))::int,
         (f.wins + f.losses + f.draws)
  from public.fighters f
  where f.division = p_division
    and (f.wins + f.losses + f.draws) > 0
  order by 3 desc, f.wins desc, f.created_at asc
  limit 100;
$$;

grant execute on function public.contenders(smallint) to anon, authenticated;

-- nothing here is used any more
drop table if exists public.title_challenges cascade;
drop table if exists public.card_bouts cascade;
drop table if exists public.cards cascade;
