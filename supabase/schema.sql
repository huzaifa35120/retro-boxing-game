-- RETRO BOXING - database schema
-- Paste the whole file into the Supabase SQL editor and run it once.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  handle      text unique not null check (char_length(handle) between 3 and 16),
  created_at  timestamptz not null default now()
);

-- give every new account a profile automatically
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text;
begin
  -- letters and digits only, then capped so the handle always fits 3..16
  base := upper(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9]', '', 'g'));
  base := left(base, 10);
  if char_length(base) < 2 then base := 'BOXER'; end if;
  insert into public.profiles (id, handle)
  values (new.id, base || substr(replace(new.id::text, '-', ''), 1, 5));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- fighters
create table if not exists public.fighters (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references auth.users on delete cascade,
  slot         smallint not null check (slot between 0 and 2),
  name         text not null check (char_length(name) between 1 and 10),
  division     smallint not null check (division between 0 and 5),
  skin         smallint not null check (skin between 0 and 5),
  shorts       smallint not null check (shorts between 0 and 9),
  country      smallint not null check (country between 0 and 29),
  -- official record. Clients cannot write these (see the grants below);
  -- only a match-reporting function on the server ever touches them.
  wins         int not null default 0,
  losses       int not null default 0,
  draws        int not null default 0,
  ko_for       int not null default 0,
  ko_against   int not null default 0,
  -- sparring, which never counts towards a ranking
  training_w   int not null default 0,
  training_l   int not null default 0,
  training_d   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (owner, slot)
);

create index if not exists fighters_division_idx on public.fighters (division);

-- ----------------------------------------------------------------- matches
create table if not exists public.matches (
  id           uuid primary key default gen_random_uuid(),
  division     smallint not null,
  red          uuid not null references public.fighters on delete cascade,
  blue         uuid not null references public.fighters on delete cascade,
  winner       uuid references public.fighters on delete set null,  -- null = draw
  method       text not null check (method in ('ko','tko','decision','draw')),
  rounds       jsonb,          -- per-round stats and the judges' cards
  is_title     boolean not null default false,
  card_id      uuid,
  played_at    timestamptz not null default now()
);

-- ------------------------------------------------------------- fight rooms
create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  host         uuid not null references auth.users on delete cascade,
  host_fighter uuid references public.fighters on delete cascade,
  guest        uuid references auth.users on delete set null,
  guest_fighter uuid references public.fighters on delete set null,
  division     smallint not null,
  status       text not null default 'open' check (status in ('open','full','live','done')),
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------- event cards
create table if not exists public.cards (
  id           uuid primary key default gen_random_uuid(),
  division     smallint not null,
  opens_at     timestamptz not null,     -- Saturday
  starts_at    timestamptz not null,     -- Sunday 7pm Australia/Sydney
  status       text not null default 'announced'
                 check (status in ('announced','open','live','done'))
);

create table if not exists public.card_bouts (
  id           uuid primary key default gen_random_uuid(),
  card_id      uuid not null references public.cards on delete cascade,
  section      text not null check (section in ('main','prelim')),
  is_title     boolean not null default false,
  red          uuid references public.fighters on delete set null,
  blue         uuid references public.fighters on delete set null,
  match_id     uuid references public.matches on delete set null
);

-- ------------------------------------------------------------- leaderboard
-- Top of each division on win percentage. Needs at least one official bout,
-- so a 0-0 fighter cannot sit at 100%.
create or replace view public.leaderboard as
  select f.id, f.name, f.division, f.country, f.skin, f.shorts,
         f.wins, f.losses, f.draws, f.ko_for,
         (f.wins + f.losses + f.draws) as bouts,
         round(100.0 * f.wins / (f.wins + f.losses + f.draws))::int as win_pct,
         p.handle
  from public.fighters f
  join public.profiles p on p.id = f.owner
  where (f.wins + f.losses + f.draws) > 0;

-- ------------------------------------------------------- row level security
alter table public.profiles  enable row level security;
alter table public.fighters  enable row level security;
alter table public.matches   enable row level security;
alter table public.rooms     enable row level security;
alter table public.cards     enable row level security;
alter table public.card_bouts enable row level security;

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for update using (auth.uid() = id);

drop policy if exists "fighters are public" on public.fighters;
create policy "fighters are public" on public.fighters for select using (true);
drop policy if exists "make own fighters" on public.fighters;
create policy "make own fighters" on public.fighters for insert with check (auth.uid() = owner);
drop policy if exists "change own fighters" on public.fighters;
create policy "change own fighters" on public.fighters for update using (auth.uid() = owner);
drop policy if exists "retire own fighters" on public.fighters;
create policy "retire own fighters" on public.fighters for delete using (auth.uid() = owner);

drop policy if exists "matches are public" on public.matches;
create policy "matches are public" on public.matches for select using (true);
drop policy if exists "rooms are public" on public.rooms;
create policy "rooms are public" on public.rooms for select using (true);
drop policy if exists "host a room" on public.rooms;
create policy "host a room" on public.rooms for insert with check (auth.uid() = host);
drop policy if exists "update own room" on public.rooms;
create policy "update own room" on public.rooms
  for update using (auth.uid() = host or auth.uid() = guest);
drop policy if exists "cards are public" on public.cards;
create policy "cards are public" on public.cards for select using (true);
drop policy if exists "bouts are public" on public.card_bouts;
create policy "bouts are public" on public.card_bouts for select using (true);

-- ------------------------------------------------------------ column grants
-- The important one. A player may change his shorts and his sparring record,
-- and nothing else - so nobody can hand himself a 50-0 record.
revoke all on public.fighters from anon, authenticated;
grant select on public.fighters to anon, authenticated;
grant insert on public.fighters to authenticated;
grant update (shorts, training_w, training_l, training_d) on public.fighters to authenticated;
grant delete on public.fighters to authenticated;
grant select on public.leaderboard to anon, authenticated;
