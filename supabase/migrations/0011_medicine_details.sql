-- Phase 3, item 23: purpose line, packet photo, and "how much to take" as a
-- number rather than free text. See docs/phase-3-plan.md.
--
-- Three changes in one migration on purpose. A new medicine column has to be
-- threaded through seven places -- this file, public.get_routine,
-- public.upsert_medicine, app.compute_day, mapMedicine in js/sync.js, the
-- medicine form, and (for a column the photo edge function writes) the
-- column-level service_role grant in section 4 below. mapMedicine enumerates
-- columns explicitly and the grant is column-scoped, so a column missed in
-- either place fails silently or with an error that names nothing useful.
-- Doing that threading once for three columns is materially safer than doing
-- it three times.
--
-- ---------------------------------------------------------------------------
-- BEFORE RUNNING THIS, read what is about to be converted:
--
--   select id, name, form, dosage, app.parse_dose(dosage) as becomes
--     from public.medicines order by name;
--
-- (Create the function first -- it is defined below and is safe to create on
-- its own.) At this app's scale that is a screenful. Two things to look for:
--
--   * A row where someone typed frequency into the dosage field, e.g.
--     "1 tablet twice a day". The "twice a day" is lost. That information was
--     already in the wrong place -- frequency lives in public.schedules -- but
--     check the medicine's schedules actually say so before losing the note.
--
--   * A liquid measured in something other than millilitres, e.g. "1 spoon".
--     The unit is derived from `form` after this migration, so that row will
--     render as "1 ml". Either accept it or set the medicine's form to
--     'other', which renders "1 dose".
--
-- The conversion is not reversible. `dosage` is dropped at the end.
-- ---------------------------------------------------------------------------

-- ============================================================
-- 1. Parse a leading quantity out of free text
-- ============================================================

-- Deliberately forgiving and deliberately never zero: an unreadable value
-- becomes 1, which is the overwhelmingly common real answer and is visible
-- and correctable in the form. Returning null would put a not-null column in
-- the way of a migration that has already dropped its source data.
create or replace function app.parse_dose(p text) returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  s     text := lower(btrim(coalesce(p, '')));
  m     text[];
  value numeric;
begin
  -- Vulgar fractions, because "half a tablet" is usually typed as one glyph.
  s := replace(s, '½', ' 1/2');
  s := replace(s, '¼', ' 1/4');
  s := replace(s, '¾', ' 3/4');
  s := btrim(s);

  -- "1 1/2 tablets" -> 1.5, "1/2 tablet" -> 0.5. The leading whole number is
  -- optional, and the regex backtracks into the fraction when it is absent.
  m := regexp_match(s, '^([0-9]+)?\s*([0-9]+)\s*/\s*([0-9]+)');
  if m is not null and m[3]::numeric <> 0 then
    value := coalesce(m[1]::numeric, 0) + (m[2]::numeric / m[3]::numeric);
  else
    -- "2 tablets", "0.5 ml", "10 drops".
    m := regexp_match(s, '^([0-9]+(\.[0-9]+)?)');
    if m is not null then value := m[1]::numeric; end if;
  end if;

  if value is null or value <= 0 then return 1; end if;
  return least(round(value, 2), 99);
end $$;

-- ============================================================
-- 2. The new columns
-- ============================================================

alter table public.medicines
  add column if not exists purpose text not null default ''
    check (length(purpose) <= 120),
  add column if not exists packet_photo_path text,
  add column if not exists dose_qty numeric(4,2) not null default 1
    check (dose_qty > 0 and dose_qty <= 99);

-- `purpose` is capped at 120 characters on purpose: it is a sentence a
-- supporter writes so that whoever fills the organiser knows what they are
-- holding ("for blood pressure"). A paragraph would read as clinical advice,
-- which this app does not give.

update public.medicines set dose_qty = app.parse_dose(dosage);

alter table public.medicines drop column dosage;

-- ============================================================
-- 3. The function surface
-- ============================================================

-- Also fixes an omission from 0001: the returning object never included
-- photo_path, so a save appeared to clear the photo until the next sync.
create or replace function public.upsert_medicine(p_code text, p_medicine jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code); v_id uuid;
begin
  v_id := coalesce((p_medicine->>'id')::uuid, gen_random_uuid());
  insert into public.medicines (id, household_id, name, strength, dose_qty, form, notes, purpose)
  values (v_id, v_household, p_medicine->>'name',
          coalesce(p_medicine->>'strength', ''),
          coalesce((p_medicine->>'doseQty')::numeric, 1),
          coalesce(p_medicine->>'form', 'tablet'),
          coalesce(p_medicine->>'notes', ''),
          coalesce(p_medicine->>'purpose', ''))
  on conflict (id) do update set
    name = excluded.name, strength = excluded.strength, dose_qty = excluded.dose_qty,
    form = excluded.form, notes = excluded.notes, purpose = excluded.purpose,
    updated_at = now()
  where medicines.household_id = v_household
  returning jsonb_build_object('id', id, 'name', name, 'strength', strength,
    'doseQty', dose_qty, 'form', form, 'notes', notes, 'purpose', purpose,
    'archived', archived, 'photoPath', photo_path,
    'packetPhotoPath', packet_photo_path) into p_medicine;
  return p_medicine;
end $$;

create or replace function public.get_routine(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  return jsonb_build_object(
    'household', (select jsonb_build_object('displayName', display_name, 'timezone', timezone)
                    from public.households where id = v_household),
    'slots', coalesce((select jsonb_agg(jsonb_build_object(
                'id', id, 'label', label, 'time', to_char(time, 'HH24:MI'),
                'order', sort_order, 'builtIn', built_in) order by sort_order)
              from public.slots where household_id = v_household and not archived), '[]'::jsonb),
    'medicines', coalesce((select jsonb_agg(jsonb_build_object(
                'id', id, 'name', name, 'strength', strength, 'doseQty', dose_qty,
                'form', form, 'notes', notes, 'purpose', purpose, 'archived', archived,
                'photoPath', photo_path, 'packetPhotoPath', packet_photo_path))
              from public.medicines where household_id = v_household), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(jsonb_build_object(
                'id', id, 'medicineId', medicine_id, 'slotId', slot_id,
                'time', to_char(time, 'HH24:MI'), 'active', active,
                'frequency', jsonb_build_object(
                  'type', freq_type, 'interval', freq_interval,
                  'daysOfWeek', freq_days_of_week, 'anchorDate', freq_anchor_date)))
              from public.schedules where household_id = v_household and active), '[]'::jsonb)
  );
end $$;

-- Snapshots carry doseQty and purpose from here on. Rows frozen before this
-- migration keep `dosage` as text and are NOT rewritten -- not rewriting them
-- is the entire point of freezing them. js/views/day.js renders whichever of
-- the two a snapshot happens to carry, the same way js/schedule.js already
-- falls back when a snapshot predates `slotTime` (migration 0010).
create or replace function app.compute_day(p_household uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with due as (
    select sl.id as slot_id, sl.label, sl.time as slot_time,
           coalesce(sc.time, sl.time) as t,
           m.id as medicine_id, m.name, m.strength, m.dose_qty, m.notes, m.form, m.purpose
      from public.schedules sc
      join public.slots sl on sl.id = sc.slot_id and sl.household_id = sc.household_id
      join public.medicines m on m.id = sc.medicine_id and m.household_id = sc.household_id
     where sc.household_id = p_household and sc.active
       and not m.archived and not sl.archived
       and app.is_due(sc.freq_type, sc.freq_interval, sc.freq_days_of_week, sc.freq_anchor_date, p_date)
  ),
  per_slot as (
    select slot_id, min(label) as label, min(slot_time) as slot_time,
           min(t) as t,
           jsonb_agg(distinct jsonb_build_object(
             'medicineId', medicine_id, 'name', name, 'strength', strength,
             'doseQty', dose_qty, 'notes', notes, 'form', form, 'purpose', purpose,
             'time', to_char(t, 'HH24:MI'))) as medicines
      from due group by slot_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'slotId', slot_id, 'label', label,
           'time', to_char(t, 'HH24:MI'),
           'slotTime', to_char(slot_time, 'HH24:MI'),
           'medicines', medicines
         ) order by slot_time, t), '[]'::jsonb)
    from per_slot;
$$;

-- Unchanged from 0001, restated because the signatures did not change and the
-- grants are per-function rather than cumulative.
revoke all on function public.get_routine(text), public.upsert_medicine(text, jsonb) from public, anon;
grant execute on function public.get_routine(text), public.upsert_medicine(text, jsonb)
  to anon, authenticated;

-- ============================================================
-- 4. The seventh threading point
-- ============================================================

-- 0002 granted service_role `update (photo_path)` -- a COLUMN-level grant, and
-- deliberately so: the supporter-photo function has no business writing
-- anything else on this table. That precision is exactly what makes it a place
-- a new column has to be added. service_role bypasses RLS but not ordinary
-- column privileges, so without this the packet upload fails with "permission
-- denied for column packet_photo_path" -- from an edge function whose only
-- error path is a 400 with no detail.
grant update (packet_photo_path) on public.medicines to service_role;
