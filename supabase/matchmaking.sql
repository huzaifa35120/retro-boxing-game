-- RETRO BOXING - casual matchmaking
-- Run after tournament.sql.

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

-- Both fighters call this and both get the same room.

grant execute on function public.find_casual(uuid) to authenticated;
grant execute on function public.leave_casual(uuid) to authenticated;


