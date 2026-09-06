-- Supporter parity: history the supporter can read, and doses they can mark.
--
-- A supporter device has no session. Every call it makes resolves a household
-- from a share code through a `security definer` function, because RLS on
-- these tables is scoped to `app.my_household()` and `auth.uid()` is null
-- there. Reading a dose log therefore needs a function, not a policy, and so
-- does writing one. That is the whole reason this file exists.
--
-- WHY THE SUPPORTER MAY WRITE AT ALL
--
-- Supporters genuinely fill the weekly organiser and sit with the person while
-- they take a dose, so a supporter who cannot mark anything ends up telling
-- the elder to go and tap their own phone. But two devices writing the same
-- log silently would quietly erode what the calendar means -- "taken" would
-- stop being something the person did.
--
-- So the write is allowed and attributed: `logged_by` records which side made
-- the row, the supporter's UI puts one confirmation in front of it, and the
-- elder's screens can say a dose was marked for them. Attribution is the price
-- of the capability, not an afterthought.
--
-- These functions deliberately do NOT relax the locked-day window. They apply
-- exactly the same date bounds as the elder's RLS policies, so a share code
-- reaches no further back in time than the household owner can.

-- ============================================================
-- 1. Who marked it
-- ============================================================

-- Nullable rather than defaulted to 'patient': rows written before this
-- migration were not necessarily the patient's doing in some future import,
-- and null honestly means "not recorded" instead of asserting something the
-- data does not know. Readers treat null as the patient, which is what every
-- existing row actually is today.
alter table public.dose_log
  add column if not exists logged_by text
  check (logged_by in ('patient', 'supporter'));

comment on column public.dose_log.logged_by is
  'Which device recorded this row. Null on rows predating 0006, all of which were the patient.';

-- ============================================================
-- 2. Reads
-- ============================================================

-- Dose log for a date range. Bounded on purpose: the supporter's calendar
-- pages a month at a time, and an unbounded fetch of a multi-year history over
-- a phone connection is a cost nobody asked for.
create or replace function public.get_dose_log(p_code text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  if p_to < p_from then
    raise exception 'range ends before it starts' using errcode = '22007';
  end if;
  -- A supporter paging quickly could otherwise ask for a decade in one call.
  if p_to - p_from > 400 then
    raise exception 'range too wide' using errcode = '22003';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'medicineId', medicine_id, 'slotId', slot_id,
      'date', local_date, 'takenAt', taken_at,
      'status', status, 'loggedBy', logged_by))
    from public.dose_log
    where household_id = v_household
      and local_date between p_from and p_to
  ), '[]'::jsonb);
end $$;

-- Frozen days, so the supporter renders what was actually expected at the time
-- rather than recomputing today's routine over last month -- the asymmetry
-- next-steps.md section 2 warned about. Also returns the two dates every
-- calendar needs to know which days are editable at all.
create or replace function public.get_history(p_code text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  return jsonb_build_object(
    'localDate', app.household_local_date(v_household),
    'lockedThrough', (select locked_through from public.households where id = v_household),
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object('date', local_date, 'slots', slots))
      from public.day_snapshots
      where household_id = v_household and local_date between p_from and p_to
    ), '[]'::jsonb)
  );
end $$;

-- ============================================================
-- 3. Writes
-- ============================================================

-- One medicine, one state. Mirrors the client's cycling target, including
-- p_status of null meaning "back to unmarked", so the supporter's path and the
-- elder's converge on the same three states rather than growing a second
-- vocabulary.
create or replace function public.log_dose(
  p_code text, p_date date, p_slot_id uuid, p_medicine_id uuid, p_status text
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  -- Identical bounds to the dose_insert / dose_update policies. A share code
  -- must not reach a day the household owner's own session could not.
  if p_date > app.household_local_date(v_household)
     or p_date < app.household_open_from(v_household) then
    raise exception 'that day cannot be changed' using errcode = 'P0003';
  end if;

  if p_status is null then
    delete from public.dose_log
     where household_id = v_household and local_date = p_date
       and slot_id = p_slot_id and medicine_id = p_medicine_id;
    return;
  end if;

  if p_status not in ('taken', 'skipped') then
    raise exception 'unknown status' using errcode = '22023';
  end if;

  insert into public.dose_log
    (household_id, medicine_id, slot_id, local_date, status, logged_by)
  values (v_household, p_medicine_id, p_slot_id, p_date, p_status, 'supporter')
  on conflict (household_id, local_date, slot_id, medicine_id) do update
    set status = excluded.status,
        taken_at = now(),
        logged_by = 'supporter';
end $$;

-- Clears a whole slot, matching the elder's Undo: put this slot back to
-- untouched, skips included.
create or replace function public.unlog_slot(p_code text, p_date date, p_slot_id uuid)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code); v_n integer;
begin
  if p_date < app.household_open_from(v_household) then
    raise exception 'that day cannot be changed' using errcode = 'P0003';
  end if;

  with gone as (
    delete from public.dose_log
     where household_id = v_household and local_date = p_date and slot_id = p_slot_id
    returning 1
  )
  select count(*) into v_n from gone;
  return v_n;
end $$;

-- ============================================================
-- 4. Grants
-- ============================================================

revoke all on function
  public.get_dose_log(text, date, date), public.get_history(text, date, date),
  public.log_dose(text, date, uuid, uuid, text), public.unlog_slot(text, date, uuid)
  from public, anon;

grant execute on function
  public.get_dose_log(text, date, date), public.get_history(text, date, date),
  public.log_dose(text, date, uuid, uuid, text), public.unlog_slot(text, date, uuid)
  to anon, authenticated;
