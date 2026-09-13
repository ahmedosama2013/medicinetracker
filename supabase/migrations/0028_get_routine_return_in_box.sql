-- get_routine has never returned slots.in_box, ever since 0021 rewrote it to
-- add community medicine fields to the medicines array and rebuilt the whole
-- function body without carrying the 'inBox' key over from 0012's version.
--
-- The practical effect: a supporter device only ever learns which times of
-- day go in the box through this function (see js/supporter-sync.js's
-- pullRoutine, which overwrites the local slots cache -- inBox included --
-- with whatever this returns). Every supporter has therefore had every slot's
-- inBox silently reset to nothing on first sync, regardless of what 0012 and
-- 0026 seeded or backfilled on the household row -- the organiser page's
-- "which times go in the box" screen showed nothing ticked, and Morning/Night
-- never appeared selected as the default compartments the way they do on the
-- elder's device (js/sync.js reads the slots table directly and was never
-- affected).
--
-- Same fields as 0012 originally sent, just folded back into 0021's shape.

create or replace function public.get_routine(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  return jsonb_build_object(
    'household', (select jsonb_build_object(
                'displayName', display_name, 'timezone', timezone,
                'usesOrganizer', uses_organizer)
                    from public.households where id = v_household),
    'slots', coalesce((select jsonb_agg(jsonb_build_object(
                'id', id, 'label', label, 'time', to_char(time, 'HH24:MI'),
                'order', sort_order, 'builtIn', built_in, 'inBox', in_box) order by sort_order)
              from public.slots where household_id = v_household and not archived), '[]'::jsonb),
    'medicines', coalesce((select jsonb_agg(jsonb_build_object(
                'id', m.id, 'name', m.name, 'strength', m.strength, 'doseQty', m.dose_qty,
                'form', m.form, 'notes', m.notes, 'purpose', m.purpose, 'archived', m.archived,
                'photoPath', m.photo_path, 'packetPhotoPath', m.packet_photo_path,
                'communityReferenceId', m.community_reference_id, 'communityReferenceName', r.name,
                'communityReferenceStrength', r.strength, 'communityPillPhotoPath', r.pill_photo_path,
                'communityPacketPhotoPath', r.packet_photo_path))
              from public.medicines m left join public.community_medicine_references r
                on r.id = m.community_reference_id
              where m.household_id = v_household), '[]'::jsonb),
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
