-- The elder-side read policy on community_medicine_references never matched a
-- single row, so an elder could never learn a community photo's path and Today
-- and the organiser silently fell back to the generated pill tile.
--
-- 0021 shipped this predicate:
--
--   exists (select 1 from public.medicines m
--            where m.household_id = app.my_household()
--              and m.community_reference_id = id)
--
-- That trailing `id` is not community_medicine_references.id. Postgres resolves
-- an unqualified column name against the innermost FROM list first, and
-- public.medicines has its own `id` column, so the subquery bound it to m.id and
-- the test reduced to `m.community_reference_id = m.id` -- never true for real
-- data. RLS then filtered every row away, and because PostgREST reports a
-- filtered-out embedded row as `null` rather than an error, nothing anywhere
-- said so.
--
-- Supporters were unaffected throughout: public.get_routine is security definer
-- and joins the reference itself, so it never consults this policy.
--
-- Qualifying the column is the whole fix. The household test also picks up the
-- (select ...) wrapper the rest of the schema uses, so app.my_household() is
-- evaluated once per query instead of once per row.
drop policy if exists community_refs_linked_select on public.community_medicine_references;
create policy community_refs_linked_select on public.community_medicine_references
  for select to authenticated
  using (exists (
    select 1
      from public.medicines m
     where m.household_id = (select app.my_household())
       and m.community_reference_id = community_medicine_references.id
  ));

-- 0024 let every authenticated user read the whole community-med-photos bucket.
-- That bucket also holds `suggestions/`: photos one household has proposed and
-- no reviewer has looked at yet. Only the published catalogue under
-- `references/` is meant to be world-readable, so scope the policy to it.
drop policy if exists community_photos_select on storage.objects;
create policy community_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'community-med-photos' and name like 'references/%');
