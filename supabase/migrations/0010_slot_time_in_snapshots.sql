-- A medicine's own time must not relabel the slot it sits in.
--
-- app.compute_day grouped by slot and took `min(t)` as the slot's time, where
-- t is coalesce(schedule.time, slot.time). So a single medicine overridden to
-- 06:00 inside an 08:00 Morning slot made the whole frozen day read
-- "Morning 6:00 am" -- for every other medicine in it too.
--
-- Nothing was ever written to public.slots; slot.time was untouched the whole
-- time. But it read exactly as though setting one medicine's time had moved
-- the slot for everything, which is how it was reported.
--
-- The grouping itself stays. dose_log is keyed (household, local_date,
-- slot_id, medicine_id) with no time in it, so two groups sharing a slot
-- cannot be marked independently -- splitting them would mean one tap
-- appearing to complete both. What changes is what gets displayed:
--
--   slotTime  the slot's own time, which the day is ordered and headlined by
--   time      per medicine, so an override stays visible on its own row
--
-- `time` is still emitted at group level, unchanged, so a client that has not
-- been updated keeps working exactly as before.

create or replace function app.compute_day(p_household uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with due as (
    select sl.id as slot_id, sl.label, sl.time as slot_time,
           coalesce(sc.time, sl.time) as t,
           m.id as medicine_id, m.name, m.strength, m.dosage, m.notes, m.form
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
             'dosage', dosage, 'notes', notes, 'form', form,
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

-- Snapshots already frozen keep the old shape. js/schedule.js falls back to
-- the group's `time` when `slotTime` is absent, so past days render exactly as
-- they did rather than being silently rewritten -- which is the whole point of
-- freezing them.
