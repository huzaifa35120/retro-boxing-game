'use strict';

/* Paste your Supabase project's two values here.

   Both are safe to ship in a browser. The anon key only ever grants what the
   row level security policies in supabase/schema.sql allow, which is why the
   record columns are not writable by clients.

   Find them in your project: Settings -> API. Either key format works -
   the newer `sb_publishable_...` or a legacy `eyJhbGci...` anon key.
   Leave them blank and the game runs offline out of local storage. */
const SUPABASE = {
  url: 'https://ixvppgcsbowpzkkkkntr.supabase.co',        // https://YOUR-PROJECT.supabase.co
  anonKey: 'sb_publishable_YnxQfaWBgtrH8z5qLsendA_hanKGBjI',   // publishable key
};
