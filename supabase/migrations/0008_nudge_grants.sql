-- Grants the nudge Edge Function actually needs.
--
-- Same trap as 0002, which is worth restating because it has now caught two
-- functions: **service_role bypasses RLS but still needs ordinary table
-- grants**, and 0001 only ever granted table access to anon and authenticated.
-- So a service_role query against a table nobody granted fails with
-- "permission denied", not with an empty result -- and a caller that ignores
-- the error cannot tell those apart.
--
-- That is exactly how this hid: the nudge function read push_subscriptions,
-- got permission denied, discarded the error, and reported "no-subscriptions"
-- for a household that had two perfectly good ones.
--
-- Column-scoped where possible. The function has no business writing anything
-- on these tables beyond the two values it owns.

grant select on public.push_subscriptions to service_role;

-- For retiring a subscription the push service reports as gone (404/410).
grant update (disabled_at) on public.push_subscriptions to service_role;

-- The nudge cooldown. See 0007.
grant update (last_nudge_at) on public.households to service_role;
