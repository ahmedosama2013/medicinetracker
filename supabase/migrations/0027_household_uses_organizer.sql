-- Whether this household uses a physical pill organizer box at all.
--
-- Not every household does, and for the ones that don't, "Fill the
-- Organizer" is a tab that leads nowhere useful -- a step in a routine they
-- have never had. This is a plain per-household boolean, defaulting to true
-- (the previous, only, behaviour) so nobody sees anything change until they
-- say otherwise.
--
-- Asked once at sign-in (see js/views/auth.js) and editable later from either
-- role's Settings. It is household state, not device state -- there is one
-- physical box or there is not -- so both phones must agree, same reasoning
-- as in_box (0012_pill_box_slots.sql).

alter table public.households
  add column if not exists uses_organizer boolean not null default true;

-- ============================================================
-- Setting it, once there is a household: from either role's Settings.
-- ============================================================

-- Mirrors set_slot_in_box(): one boolean, resolved through the share code
-- rather than a session. Called from BOTH roles' Settings -- the elder's
-- device holds the household's share code too (settings.shareCode), same as
-- set_slot_in_box, so there is one function rather than an elder-only twin.
create or replace function public.set_uses_organizer(
  p_code text, p_uses_organizer boolean
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  update public.households set uses_organizer = coalesce(p_uses_organizer, true)
   where id = v_household;
end $$;

revoke all on function public.set_uses_organizer(text, boolean) from public, anon;
grant execute on function public.set_uses_organizer(text, boolean) to anon, authenticated;

-- ============================================================
-- create_household: asked at sign-in, before the household exists.
-- ============================================================

-- A new parameter, not a change to the existing one -- overloads are
-- distinguished by argument count, and a two-arg caller still exactly matches
-- 0026's two-arg function even with a default third parameter added here.
-- Drop it first so there is exactly one create_household to find.
drop function if exists public.create_household(text, text);

create or replace function public.create_household(
  p_display_name text, p_timezone text, p_uses_organizer boolean default true
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_code text; v_today date;
begin
  if app.my_household() is not null then
    return app.my_household();
  end if;
  loop
    v_code := (select string_agg(substr(alphabet, (get_byte(extensions.gen_random_bytes(1), 0) % 30) + 1, 1), '')
               from generate_series(1, 6), (select '23456789ABCDEFGHJKMNPQRSTVWXYZ' as alphabet) a);
    begin
      insert into public.households (owner_id, display_name, timezone, share_code, uses_organizer)
      values (auth.uid(), btrim(p_display_name), p_timezone, v_code, coalesce(p_uses_organizer, true))
      returning id into v_id;
      exit;
    exception when unique_violation then null;
    end;
  end loop;

  -- in_box matches 0026's seeding: the two ends of the day, which is the
  -- 7x2 tray nearly everyone actually owns. Anything else is one tap away.
  insert into public.slots (household_id, label, time, sort_order, built_in, in_box) values
    (v_id, 'Morning', '08:00', 1, true, true), (v_id, 'Afternoon', '13:00', 2, true, false),
    (v_id, 'Evening', '18:00', 3, true, false), (v_id, 'Night', '21:00', 4, true, true);

  v_today := app.household_local_date(v_id);
  update public.households
     set snapshot_through = v_today - 1, locked_through = v_today - 1 - lock_lag_days
   where id = v_id;
  return v_id;
end $$;

revoke all on function public.create_household(text, text, boolean) from public, anon;
grant execute on function public.create_household(text, text, boolean) to authenticated;

-- ============================================================
-- get_routine: so a supporter's device learns the household's answer too.
-- ============================================================

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
                'order', sort_order, 'builtIn', built_in) order by sort_order)
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
