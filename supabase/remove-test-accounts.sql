-- Removes the throwaway accounts used to test online play end to end, and the
-- empty draw left behind by the tournament test. Their fighters and matches
-- are already gone.
delete from public.tourney_bouts
 where tourney in (select id from public.tournaments where winner is null)
   and red is null and blue is null;
delete from public.tournaments where winner is null
   and not exists (select 1 from public.tourney_bouts b where b.tourney = tournaments.id and b.red is not null);

delete from auth.users
where email in ('rbtest-a@example.com',
                'rbtest-b@example.com',
                'ringtest1@retrobox.local',
                'alfatest@retrobox.local',
                'bravotest@retrobox.local');
