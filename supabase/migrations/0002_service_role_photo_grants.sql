-- The supporter-photo Edge Function authenticates with the service_role key
-- and queries public.households/public.medicines directly (app.* functions
-- aren't reachable via PostgREST, so it can't go through app.household_by_code
-- like the code-gated RPCs do). service_role bypasses RLS but still needs
-- ordinary table grants -- this project's migration only ever granted table
-- access to anon/authenticated, never to service_role, so those direct
-- queries failed with "permission denied for table households".
grant select on public.households to service_role;
grant select, update (photo_path) on public.medicines to service_role;
