# Turning multiplayer on

The game runs offline with no setup at all — fighters live in your browser.
To get accounts and leaderboards, it needs a database. This takes about five
minutes and costs nothing.

## 1. Make a Supabase project

1. Go to <https://supabase.com> and sign up (free tier is plenty).
2. **New project.** Pick any name. Choose the region closest to your players —
   Sydney if that's where the fight nights are. Set a database password and
   keep it somewhere; you won't need it for the game.
3. Wait about two minutes for it to finish provisioning.

## 2. Create the tables

1. In your project, open **SQL Editor** in the left sidebar.
2. Open `supabase/schema.sql` from this repo, copy the whole file, paste it in.
3. Hit **Run**. It should say success.

That builds the tables for profiles, fighters, matches, rooms and event cards,
the leaderboard view, and the security rules.

The important rule it sets up: a player can change his shorts and his sparring
record and **nothing else**. Wins, losses and KOs are not writable from a
browser, so nobody can hand himself a 50-0 record. Those columns will only ever
be written by the server after a real match.

## 3. Point the game at it

1. In Supabase, go to **Settings → API**.
2. Copy the **Project URL** and the **publishable** key (newer projects call
   it `sb_publishable_...`; older ones show a long `eyJhbGci...` "anon public"
   key — either works).
3. Paste both into `js/supabase-config.js`:

```js
const SUPABASE = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'eyJhbGci...',
};
```

Both are safe to publish — the anon key only grants what the security rules
above allow.

## 4. Accounts are usernames, not emails

Run **`supabase/usernames.sql`**. Players sign up with a name and a password
and are never asked for an email address.

Supabase's password login needs an email column, so the game invents one:
`BOXER` becomes `boxer@retrobox.local`. Nothing is ever sent to it and no real
address is collected. Because Supabase allows one account per address,
usernames end up unique for free — and the game checks a name is free before
it even tries, so a taken name says so straight away.

You must also turn **email confirmation off**, since those made-up addresses
can't receive anything: **Authentication → Sign In / Providers → Email →
Confirm email → off**.

## 5. Try it

Reload the game and go **MULTIPLAYER → SIGN IN / SIGN UP**. Type an email and
password, pick CREATE ACCOUNT. You should land on the account screen with a
handle. Any fighters you made offline get pushed up to the account, and from
then on they follow you to any browser you sign in from.

**MULTIPLAYER → LEADERBOARDS** will be empty until fights are recorded — that
needs the match reporting in the next phase.

## 6. Turn on online fights

Run **`supabase/multiplayer.sql`** in the SQL editor, the same way you ran the
schema. It adds the signalling table two browsers use to find each other, the
room open/join functions, and `report_match` — the only thing in the system
allowed to touch a fighter's official record.

Then: **MULTIPLAYER → FIGHT ROOMS**. One player picks HOST A ROOM and reads out
the four-letter code; the other types it into JOIN CODE. Both fighters have to
be in the same division. Once connected the fight starts on its own.

## 7. Rankings and the leaderboard

Run these, in order:

1. **`supabase/titles.sql`** — the top-100 rankings per division. (It also
   drops the old fight-card tables, which are gone.)
2. **`supabase/matchmaking.sql`** — the quick-fight queue.
3. **`supabase/rooms-clean.sql`** — deletes closed rooms instead of leaving
   them in the table forever, and clears out the ones already there.
4. **`supabase/queue-clean.sql`** — drops players out of the quick-fight queue
   if they stop searching, so nobody is matched with a ghost.
5. **`supabase/drop-tournament.sql`** — result reporting, and the teardown for
   the Sunday draw and the belt. Run it last. On a database that never had
   them it simply defines the reporting and skips the rest.


## What still needs building

| | Needs |
| --- | --- |
| **Automatic weekly draws** | Works when a player opens the screen; add the `pg_cron` jobs above to have it happen on its own |

Everything else is built.
