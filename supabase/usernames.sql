-- Sign-up by username instead of email.
--
-- Supabase's password login needs an email column, so the game makes one up
-- from the username: BOXER becomes boxer@retrobox.local. No real address is
-- ever asked for or stored, and because Supabase enforces one account per
-- email, usernames are unique for free.
--
-- Run this once, after schema.sql.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text;
  try  text;
  n    int := 0;
begin
  -- the part before the @ is the username the player typed
  base := upper(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9]', '', 'g'));
  base := left(base, 16);
  if char_length(base) < 3 then base := 'BOXER'; end if;

  -- should never collide (the email is unique) but never fail a sign-up over it
  try := base;
  while exists (select 1 from public.profiles p where p.handle = try) loop
    n := n + 1;
    try := left(base, 13) || lpad(n::text, 3, '0');
    if n > 999 then try := left(base, 10) || substr(replace(new.id::text, '-', ''), 1, 6); exit; end if;
  end loop;

  insert into public.profiles (id, handle) values (new.id, try);
  return new;
end $$;
