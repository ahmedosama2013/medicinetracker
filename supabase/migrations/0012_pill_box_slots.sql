-- Phase 3, item 18a: which times of day go in the weekly pill box.
-- See docs/phase-3-plan.md.
--
-- Why this is a per-slot flag and not a compartment count.
--
-- Real trays are usually 7x2 or 7x4, and a household here can have any number
-- of times of day. The obvious model -- "how many compartments does your box
-- have?" -- has a hole in it: with a 7x2 tray and four times of day, the
-- afternoon and evening medicines have nowhere to go, and the only way to fit
-- them is to merge two times of day into one compartment. That would put the
-- afternoon dose in the same compartment as the morning one, where it gets
-- taken at breakfast. It is the one place this app could actively mislead
-- someone about their medicines, so the model that allows it is not used.
--
-- Instead: each time of day is either in the box or not. Two ticked gives a
-- 7x2 grid, four gives 7x4, and anything unticked is taken from its packet and
-- shown as such. Nothing is ever merged, so a compartment holds exactly one
-- time of day and the check screen's counts mean what they say.
--
-- This is household state, not device state -- there is one physical box, in
-- one kitchen -- so it lives here and both phones agree about it.

alter table public.slots
  add column if not exists in_box boolean not null default false;

-- Morning and Night, as create_household seeds them: sort_order 1 and 4 of the
-- four built-ins. Matched on sort_order because `label` is editable and will
-- be translated, so it cannot be matched on. A household that has since
-- reordered or renamed its slots may get this wrong, which is why it is one
-- tap to correct rather than something the app insists on.
update public.slots set in_box = true
 where built_in and not archived and sort_order in (1, 4);

-- ============================================================
-- Setting it
-- ============================================================

-- One boolean on one slot, and nothing else. `save_slots` already exists and
-- could carry this, but it can also archive a slot -- and this function is
-- called from the ELDER's Settings as well as the supporter's. The elder's
-- device holds the household's share code (settings.shareCode), so it can
-- reach any code-gated function; what it should not gain along the way is the
-- ability to delete a time of day from a screen about the shape of a plastic
-- tray. Narrow function, narrow blast radius.
--
-- save_slots does not touch in_box, so editing slot times leaves this alone,
-- and a newly added time of day starts outside the box.
create or replace function public.set_slot_in_box(
  p_code text, p_slot_id uuid, p_in_box boolean
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  update public.slots set in_box = coalesce(p_in_box, false)
   where id = p_slot_id and household_id = v_household;
end $$;

revoke all on function public.set_slot_in_box(text, uuid, boolean) from public, anon;
grant execute on function public.set_slot_in_box(text, uuid, boolean) to anon, authenticated;

-- ============================================================
-- Reading it
-- ============================================================

-- Restated in full: `inBox` joins the slot objects. mapSlot in js/sync.js gets
-- the same field from the table directly, since the elder's device reads
-- public.slots rather than going through here.
create or replace function public.get_routine(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  return jsonb_build_object(
    'household', (select jsonb_build_object('displayName', display_name, 'timezone', timezone)
                    from public.households where id = v_household),
    'slots', coalesce((select jsonb_agg(jsonb_build_object(
                'id', id, 'label', label, 'time', to_char(time, 'HH24:MI'),
                'order', sort_order, 'builtIn', built_in, 'inBox', in_box) order by sort_order)
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

revoke all on function public.get_routine(text) from public, anon;
grant execute on function public.get_routine(text) to anon, authenticated;
