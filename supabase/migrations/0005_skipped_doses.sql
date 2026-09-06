-- Skipped doses: a dose can now be recorded as deliberately not taken.
--
-- `status` has existed since 0001 but was pinned to a single value, so the
-- existence of a row was the only signal. Widening it is the whole data
-- change; the interesting part is the UPDATE policy below.
--
-- WHY AN UPDATE POLICY, WHEN 0001 DELIBERATELY OMITTED ONE
--
-- 0001 says: "no update grant/policy: a mistake is corrected with Undo, then
-- re-logged." That was right when logging was binary — the only edit was
-- undoing one, and a delete says that precisely.
--
-- Three states changes the shape. Moving a dose from taken to skipped is not
-- a correction of a mistake, it is a state change on a row that should keep
-- its identity. Expressing it as delete-then-insert would mean two entries in
-- the client's offline outbox (js/sync.js), which flushes in IndexedDB key
-- order rather than insertion order — so a queued delete can land after the
-- insert it was meant to precede and silently erase a dose the person
-- recorded. One idempotent upsert per state change is order-independent and
-- cannot lose a row.
--
-- The policy is gated exactly like dose_insert, including the locked-day
-- window, so it opens no date range that an insert could not already reach.
--
-- `taken_at` keeps its name and means "when this was recorded" for a skipped
-- row. Renaming it would churn every read path in the app for a column whose
-- meaning is already clear from `status`.

-- ============================================================
-- 1. Widen the status check
-- ============================================================

-- Dropped by lookup rather than by name: 0001 declared it inline, so the name
-- is whatever Postgres generated, and guessing wrong here would leave the old
-- constraint in place and silently reject every 'skipped' write.
do $$
declare v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.dose_log'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%';
  if v_name is not null then
    execute format('alter table public.dose_log drop constraint %I', v_name);
  end if;
end $$;

alter table public.dose_log
  add constraint dose_log_status_check check (status in ('taken', 'skipped'));

-- ============================================================
-- 2. Allow a row to change state in place
-- ============================================================

grant update on public.dose_log to authenticated;

create policy dose_update on public.dose_log for update to authenticated
  using (
    household_id = (select app.my_household())
    and local_date >= app.household_open_from(household_id)
  )
  with check (
    household_id = (select app.my_household())
    and local_date <= app.household_local_date(household_id)
    and local_date >= app.household_open_from(household_id)
  );
