-- FIX: leaving the quick-fight screen normally removes you from the queue,
-- but closing the tab or losing the connection left you in it forever - and
-- the next player to search would be matched with somebody who is not there.
--
-- A searching client asks every second or so, refreshing its row each time.
-- So anything that has not been refreshed in twenty seconds is nobody.
-- Run after matchmaking.sql.

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

  -- anybody who stopped asking has gone home
  delete from public.casual_queue where since < now() - interval '20 seconds';
  perform public.sweep_rooms();

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

grant execute on function public.find_casual(uuid) to authenticated;

-- clear whoever is stuck in there now
delete from public.casual_queue;
