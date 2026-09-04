-- RETRO BOXING - a full dry run of the Sunday tournament
--
-- Builds eight fighters, opens the draw, marks people in, winds the clock
-- past each round and boxes the whole thing out through the real functions -
-- check_in, settle_tournament, start_bout, report_match.
--
-- It all happens inside a transaction that rolls back at the end, so it
-- leaves nothing behind: no accounts, no fighters, no champion, no draw.
--
-- Run it in the SQL editor after tournament-rounds.sql. It prints a line per
-- step and stops at the first thing that is not as it should be, so a run
-- that ends in ALL CHECKS PASSED means the tournament works.

begin;

do $$
declare
  div     smallint := 2;                   -- welterweight
  uid     uuid;
  fid     uuid;
  users   uuid[] := '{}';
  fs      uuid[] := '{}';
  t       uuid;
  starts  timestamptz;
  b       public.tourney_bouts;
  r       public.rooms;
  n       int;
  won     uuid;
  champ   uuid;
  st      text;
  caught  text;
begin
  -- ---------------------------------------------------------- eight fighters
  for i in 1..8 loop
    uid := gen_random_uuid();
    -- the on_auth_user_created trigger gives each one a profile
    insert into auth.users (id, instance_id, aud, role, email,
                            encrypted_password, email_confirmed_at,
                            created_at, updated_at)
    values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'simtest' || i || '@retrobox.local',
            '', now(), now(), now());
    insert into public.fighters (owner, slot, name, division, skin, shorts, country,
                                 wins, losses, draws)
    values (uid, 0, 'SIM' || i, div, 1, i % 10, 0, 10 - i, i, 0)
    returning id into fid;
    users := users || uid;
    fs := fs || fid;
  end loop;
  raise notice 'built 8 fighters, seeded by record';

  -- ------------------------------------------------------------- open a draw
  t := public.open_tournament(div);
  if t is null then raise exception 'FAIL: the draw did not open'; end if;
  select count(*) into n from public.tourney_bouts where tourney = t;
  if n <> 7 then raise exception 'FAIL: expected 7 bouts, got %', n; end if;

  select count(*) into n from public.tourney_bouts
   where tourney = t and round = 1 and red = fs[1] and blue = fs[8];
  if n <> 1 then raise exception 'FAIL: the top seed is not drawn against the eighth'; end if;
  raise notice 'draw opened: 7 bouts, seeded 1v8 4v5 2v7 3v6';

  -- ------------------------------------- the timetable: 19:00, 19:30, 20:00
  select starts_at into starts from public.tournaments where id = t;
  if public.round_time(starts, 1::smallint) <> starts then
    raise exception 'FAIL: the quarters do not start on the hour'; end if;
  if public.round_time(starts, 2::smallint) <> starts + interval '30 minutes' then
    raise exception 'FAIL: the semis are not half an hour later'; end if;
  if public.round_time(starts, 3::smallint) <> starts + interval '1 hour' then
    raise exception 'FAIL: the final is not an hour later'; end if;
  raise notice 'timetable checks out: quarters, +30 min, +60 min';

  -- ---------------------------------------------- the door is shut, for now
  update public.tournaments set starts_at = now() + interval '2 hours' where id = t;
  perform set_config('request.jwt.claims', json_build_object('sub', users[1])::text, true);
  begin
    perform public.check_in(t, fs[1], 1::smallint);
    raise exception 'FAIL: marking in was allowed two hours early';
  exception when others then
    caught := SQLERRM;
    if caught like 'FAIL:%' then raise; end if;
    if caught not like '%TEN MINUTES%' then
      raise exception 'FAIL: wrong refusal two hours out: %', caught; end if;
  end;
  raise notice 'two hours out, marking in refused: %', caught;

  -- ---------------------------------------- ten minutes out, the door opens
  update public.tournaments set starts_at = now() + interval '5 minutes' where id = t;
  foreach fid in array array[fs[1], fs[8], fs[4], fs[2], fs[7], fs[3]] loop
    select owner into uid from public.fighters where id = fid;
    perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
    perform public.check_in(t, fid, 1::smallint);
  end loop;
  select count(*) into n from public.tourney_checkin where tourney = t and round = 1;
  if n <> 6 then raise exception 'FAIL: expected 6 marked in, got %', n; end if;
  raise notice 'six marked in for the quarters; seeds 5 and 6 did not';

  -- another player's fighter is not yours to mark in
  perform set_config('request.jwt.claims', json_build_object('sub', users[1])::text, true);
  begin
    perform public.check_in(t, fs[5], 1::smallint);
    raise exception 'FAIL: marked in a fighter belonging to someone else';
  exception when others then
    caught := SQLERRM;
    if caught like 'FAIL:%' then raise; end if;
    if caught not like '%NOT YOUR FIGHTER%' then
      raise exception 'FAIL: wrong refusal for another owner: %', caught; end if;
  end;
  raise notice 'refused to mark in someone elses fighter';

  -- ------------------------------------------------ 19:00 - the doors close
  update public.tournaments set starts_at = now() where id = t;
  perform public.settle_tournament(t);

  select winner into won from public.tourney_bouts where tourney = t and round = 1 and slot = 1;
  if won is distinct from fs[4] then raise exception 'FAIL: seed 4 did not walk over the absent 5'; end if;
  select winner into won from public.tourney_bouts where tourney = t and round = 1 and slot = 3;
  if won is distinct from fs[3] then raise exception 'FAIL: seed 3 did not walk over the absent 6'; end if;
  select count(*) into n from public.tourney_bouts
   where tourney = t and round = 1 and walkover and winner is not null;
  if n <> 2 then raise exception 'FAIL: expected 2 walkovers, got %', n; end if;
  raise notice 'two walkovers given against the no-shows';

  select winner into won from public.tourney_bouts where tourney = t and round = 1 and slot = 0;
  if won is not null then raise exception 'FAIL: a contested bout was settled without being boxed'; end if;
  raise notice 'contested bouts left for the players to box';

  -- ------------------------------------- box the two contested quarter finals
  for i in 0..2 by 2 loop
    select * into b from public.tourney_bouts where tourney = t and round = 1 and slot = i;
    select owner into uid from public.fighters where id = b.red;
    perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
    r := public.start_bout(b.id);
    select owner into uid from public.fighters where id = b.blue;
    perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
    r := public.start_bout(b.id);
    if r.guest is null then raise exception 'FAIL: the second man did not get into the room'; end if;
    perform public.report_match(r.id, b.red, 'decision', '[]'::jsonb);
  end loop;
  raise notice 'both contested quarters boxed and reported';

  select count(*) into n from public.tourney_bouts
   where tourney = t and round = 2 and red is not null and blue is not null;
  if n <> 2 then raise exception 'FAIL: the semis are not filled - % ready', n; end if;
  raise notice 'winners carried into the semi finals';

  -- ---------------------------------------------------- 19:30 - semi finals
  -- wind the clock on so the semis are due now
  update public.tournaments set starts_at = now() - interval '25 minutes' where id = t;
  for b in select * from public.tourney_bouts where tourney = t and round = 2 loop
    foreach fid in array array[b.red, b.blue] loop
      select owner into uid from public.fighters where id = fid;
      perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
      perform public.check_in(t, fid, 2::smallint);
    end loop;
  end loop;
  raise notice 'all four marked in for the semis';

  update public.tournaments set starts_at = now() - interval '30 minutes' where id = t;
  perform public.settle_tournament(t);
  select count(*) into n from public.tourney_bouts
   where tourney = t and round = 2 and winner is not null;
  if n <> 0 then raise exception 'FAIL: a semi was walked over with everyone present'; end if;
  raise notice 'nobody walked over: all four were there';

  for b in select * from public.tourney_bouts where tourney = t and round = 2 loop
    select owner into uid from public.fighters where id = b.red;
    perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
    r := public.start_bout(b.id);
    select owner into uid from public.fighters where id = b.blue;
    perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
    r := public.start_bout(b.id);
    perform public.report_match(r.id, b.red, 'tko', '[]'::jsonb);
  end loop;
  select * into b from public.tourney_bouts where tourney = t and round = 3 and slot = 0;
  if b.red is null or b.blue is null then raise exception 'FAIL: the final is not set'; end if;
  raise notice 'semis boxed, the final is set';

  -- --------------------------------------------------------- 20:00 - final
  update public.tournaments set starts_at = now() - interval '55 minutes' where id = t;
  foreach fid in array array[b.red, b.blue] loop
    select owner into uid from public.fighters where id = fid;
    perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
    perform public.check_in(t, fid, 3::smallint);
  end loop;
  update public.tournaments set starts_at = now() - interval '1 hour' where id = t;
  perform public.settle_tournament(t);

  select owner into uid from public.fighters where id = b.red;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  r := public.start_bout(b.id);
  select owner into uid from public.fighters where id = b.blue;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  r := public.start_bout(b.id);
  perform public.report_match(r.id, b.red, 'ko', '[]'::jsonb);
  raise notice 'the final is boxed';

  -- ------------------------------------------------------------- the belt
  select status, winner into st, won from public.tournaments where id = t;
  if st <> 'done' then raise exception 'FAIL: the tournament is still %', st; end if;
  if won is distinct from b.red then raise exception 'FAIL: the wrong man is down as winner'; end if;

  select fighter into champ from public.champions where division = div;
  if champ is distinct from b.red then raise exception 'FAIL: the belt did not go to the winner'; end if;
  raise notice 'champion crowned: %', (select name from public.fighters where id = champ);

  select wins into n from public.fighters where id = champ;
  raise notice 'he leaves with % wins on his record', n;

  raise notice '----------------------------------------';
  raise notice 'ALL CHECKS PASSED';
end $$;

-- ============================================================ edge cases
do $$
declare
  div smallint := 3; uid uuid; fid uuid;
  users uuid[] := '{}'; fs uuid[] := '{}';
  t uuid; b public.tourney_bouts; n int; won uuid; caught text; st text;
begin
  for i in 1..8 loop
    uid := gen_random_uuid();
    insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
    values (uid,'authenticated','authenticated','edge'||i||'@retrobox.local','',now(),now());
    insert into public.fighters (owner, slot, name, division, skin, shorts, country, wins, losses, draws)
    values (uid, 0, 'EDGE'||i, div, 1, 0, 0, 10-i, i, 0) returning id into fid;
    users := users || uid; fs := fs || fid;
  end loop;
  t := public.open_tournament(div);

  -- 1. too late to mark in once the round has begun
  update public.tournaments set starts_at = now() - interval '1 minute' where id = t;
  perform set_config('request.jwt.claims', json_build_object('sub', users[1])::text, true);
  begin
    perform public.check_in(t, fs[1], 1::smallint);
    raise exception 'FAIL: marking in was allowed after the round started';
  exception when others then
    caught := SQLERRM;
    if caught like 'FAIL:%' then raise; end if;
    if caught not like '%TOO LATE%' then raise exception 'FAIL: wrong late refusal: %', caught; end if;
  end;
  raise notice 'ok 1: too late to mark in once the round has started';

  -- 2. marking in for a round you are not in
  update public.tournaments set starts_at = now() + interval '5 minutes' where id = t;
  begin
    perform public.check_in(t, fs[1], 3::smallint);
    raise exception 'FAIL: marked in for a round he is not in';
  exception when others then
    caught := SQLERRM;
    if caught like 'FAIL:%' then raise; end if;
    if caught not like '%NOT IN THAT ROUND%' then raise exception 'FAIL: wrong round refusal: %', caught; end if;
  end;
  raise notice 'ok 2: cannot mark in for a round he is not in';

  -- 3. nobody at all turns up for the quarters
  update public.tournaments set starts_at = now() where id = t;
  perform public.settle_tournament(t);
  select count(*) into n from public.tourney_bouts where tourney = t and round = 1 and walkover;
  if n <> 4 then raise exception 'FAIL: expected 4 dead quarters, got %', n; end if;
  select count(*) into n from public.tourney_bouts where tourney = t and round = 1 and winner is not null;
  if n <> 0 then raise exception 'FAIL: a winner came out of a bout nobody turned up for'; end if;
  raise notice 'ok 3: all four quarters dead, nobody advanced';

  -- 4. settling again and again must not change anything
  for i in 1..5 loop perform public.settle_tournament(t); end loop;
  select count(*) into n from public.tourney_bouts where tourney = t and winner is not null;
  if n <> 0 then raise exception 'FAIL: repeated settling invented % winners', n; end if;
  select status into st from public.tournaments where id = t;
  if st = 'done' then raise exception 'FAIL: an empty tournament was marked finished'; end if;
  select count(*) into n from public.champions where division = div;
  if n <> 0 then raise exception 'FAIL: a belt was handed out with nobody in the draw'; end if;
  raise notice 'ok 4: settling five more times changed nothing, no belt given away';

  raise notice 'EDGE CHECKS PASSED';
end $$;

-- ================================================ winning on walkovers alone
do $$
declare
  div smallint := 4; uid uuid; fid uuid;
  users uuid[] := '{}'; fs uuid[] := '{}';
  t uuid; b public.tourney_bouts; n int; won uuid; champ uuid; st text;
begin
  for i in 1..8 loop
    uid := gen_random_uuid();
    insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
    values (uid,'authenticated','authenticated','walk'||i||'@retrobox.local','',now(),now());
    insert into public.fighters (owner, slot, name, division, skin, shorts, country, wins, losses, draws)
    values (uid, 0, 'WALK'||i, div, 1, 0, 0, 10-i, i, 0) returning id into fid;
    users := users || uid; fs := fs || fid;
  end loop;
  t := public.open_tournament(div);

  -- only the top seed ever turns up, for every round
  update public.tournaments set starts_at = now() + interval '5 minutes' where id = t;
  perform set_config('request.jwt.claims', json_build_object('sub', users[1])::text, true);
  perform public.check_in(t, fs[1], 1::smallint);

  update public.tournaments set starts_at = now() where id = t;
  perform public.settle_tournament(t);
  select winner into won from public.tourney_bouts where tourney = t and round = 1 and slot = 0;
  if won is distinct from fs[1] then raise exception 'FAIL: the only man there did not go through'; end if;
  select red into won from public.tourney_bouts where tourney = t and round = 2 and slot = 0;
  if won is distinct from fs[1] then raise exception 'FAIL: he was not carried into the semi'; end if;
  raise notice 'ok: walked over in the quarters, carried into the semi';

  -- semis: he marks in, nobody else exists to face him
  update public.tournaments set starts_at = now() - interval '25 minutes' where id = t;
  perform public.check_in(t, fs[1], 2::smallint);
  update public.tournaments set starts_at = now() - interval '30 minutes' where id = t;
  perform public.settle_tournament(t);
  select winner into won from public.tourney_bouts where tourney = t and round = 2 and slot = 0;
  if won is distinct from fs[1] then raise exception 'FAIL: he did not walk over the empty semi'; end if;
  raise notice 'ok: walked over the empty semi final';

  -- final: same again
  update public.tournaments set starts_at = now() - interval '55 minutes' where id = t;
  perform public.check_in(t, fs[1], 3::smallint);
  update public.tournaments set starts_at = now() - interval '1 hour' where id = t;
  perform public.settle_tournament(t);

  select status, winner into st, won from public.tournaments where id = t;
  if st <> 'done' then raise exception 'FAIL: still %', st; end if;
  if won is distinct from fs[1] then raise exception 'FAIL: wrong winner'; end if;
  select fighter into champ from public.champions where division = div;
  if champ is distinct from fs[1] then raise exception 'FAIL: the belt did not follow'; end if;
  raise notice 'ok: champion by walkovers alone - %', (select name from public.fighters where id = champ);

  -- his record should NOT show wins for bouts nobody boxed
  select wins into n from public.fighters where id = fs[1];
  raise notice 'his record reads % wins (walkovers are not recorded as fights)', n;

  raise notice 'WALKOVER CHAIN PASSED';
end $$;

rollback;
