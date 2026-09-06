-- The supporter's nudge: one column, holding when the last one was sent.
--
-- The rate limit lives here rather than in the client because a worried
-- relative tapping a button four times must not produce four buzzes on an
-- elderly person's phone, and a client-side limit is a suggestion. The
-- supporter-facing function reads and writes this with the service_role key
-- (see supabase/functions/nudge), so no policy change is needed: the column is
-- not exposed to anon or authenticated at all.
--
-- A column rather than a table: there is exactly one value per household and
-- no history worth keeping. If a "nudges sent" log is ever wanted it should be
-- designed deliberately, not fall out of rate limiting -- and it would need
-- thinking about first, because a record of how often someone needed chasing
-- is precisely the kind of thing this app has decided not to keep.

alter table public.households
  add column if not exists last_nudge_at timestamptz;

comment on column public.households.last_nudge_at is
  'Rate limit for the supporter nudge. Written only by the nudge Edge Function.';
