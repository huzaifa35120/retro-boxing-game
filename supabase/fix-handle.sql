-- FIX: the new-account trigger could build a handle longer than the 16
-- character limit on profiles.handle, which made sign-up fail for anyone with
-- a long email address. Paste this into the SQL editor and run it once.

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

-- and give a profile to any account that got created without one
insert into public.profiles (id, handle)
select u.id,
       left(upper(regexp_replace(split_part(u.email, '@', 1), '[^a-zA-Z0-9]', '', 'g')), 10)
         || substr(replace(u.id::text, '-', ''), 1, 5)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
