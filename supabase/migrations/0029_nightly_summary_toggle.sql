-- Whether this household gets the nightly catch-all at all.
--
-- The nightly summary (0015, 0018) goes to every subscription on the
-- household, elder and supporters alike, and until now there was no way to
-- stop it short of turning every notification off. For a supporter in
-- another timezone it can also land at an odd hour of their own day -- 23:50
-- in Karachi is late afternoon in Germany -- and read as a misfired reminder.
--
-- One household-wide switch rather than one per phone: it is one message
-- about the elder's day, and both phones should agree on whether that message
-- exists, same reasoning as uses_organizer (0027). Defaults to true, the
-- previous and only behaviour, so nobody sees a change until they choose to.

alter table public.households
  add column if not exists nightly_summary_enabled boolean not null default true;

-- ============================================================
-- Setting it: from either role's Settings, through the share code.
-- ============================================================

-- Mirrors set_uses_organizer(): the elder's device holds the share code too,
-- so one code-gated function serves both roles.
create or replace function public.set_nightly_summary(
  p_code text, p_enabled boolean
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  update public.households set nightly_summary_enabled = coalesce(p_enabled, true)
   where id = v_household;
end $$;

revoke all on function public.set_nightly_summary(text, boolean) from public, anon;
grant execute on function public.set_nightly_summary(text, boolean) to anon, authenticated;

-- ============================================================
-- claim_daily_summary: skip households that turned it off.
-- ============================================================

-- Same signature and return columns as 0018, so CREATE OR REPLACE is enough
-- and the public.claim_daily_summary() wrapper keeps working untouched. The
-- only change is the filter in `hh`.
create or replace function app.claim_daily_summary(
  p_window interval default '20 minutes',
  p_retry  interval default '4 minutes'
) returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text,
  household_id uuid, local_date date, role text, elder_name text
)
language sql volatile security definer set search_path = '' as $$
  with hh as (
    select h.id, h.timezone, h.nightly_summary_time, h.display_name,
           (now() at time zone h.timezone)::date as today
      from public.households h
     where h.nightly_summary_enabled
  ),
  in_window as (
    select hh.id, hh.timezone, hh.nightly_summary_time, hh.display_name, hh.today
      from hh
     where now() >= ((hh.today + hh.nightly_summary_time) at time zone hh.timezone)
       and now() <  ((hh.today + hh.nightly_summary_time) at time zone hh.timezone) + p_window
  ),
  pending as (
    select w.id as household_id, w.today as local_date, w.display_name
      from in_window w
     where exists (
       select 1 from app.unlogged_slots(w.id, w.today) u
        where u.fire_time <= w.nightly_summary_time
     )
  ),
  claimed as (
    insert into app.daily_summary_sends (household_id, local_date, attempts)
    select household_id, local_date, 1 from pending
    on conflict (household_id, local_date) do update
      set attempts = app.daily_summary_sends.attempts + 1, claimed_at = now()
      where app.daily_summary_sends.sent_at is null
        and app.daily_summary_sends.attempts < 3
        and app.daily_summary_sends.claimed_at < now() - p_retry
    returning household_id, local_date
  )
  select ps.id, ps.endpoint, ps.p256dh, ps.auth_key, c.household_id, c.local_date,
         ps.role, p.display_name
    from claimed c
    join pending p on p.household_id = c.household_id and p.local_date = c.local_date
    join public.push_subscriptions ps
      on ps.household_id = c.household_id and ps.disabled_at is null and ps.notify_due;
$$;

revoke all on function app.claim_daily_summary(interval, interval) from public, anon, authenticated;

-- ============================================================
-- get_routine: so a supporter's device learns the setting, and the time.
-- ============================================================

-- 0028's body with two keys added to `household`. The time is sent so the
-- Settings note can say when the message arrives instead of hard-coding
-- 23:50, which is only the column's default.
create or replace function public.get_routine(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  return jsonb_build_object(
    'household', (select jsonb_build_object(
                'displayName', display_name, 'timezone', timezone,
                'usesOrganizer', uses_organizer,
                'nightlySummary', nightly_summary_enabled,
                'nightlySummaryTime', to_char(nightly_summary_time, 'HH24:MI'))
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
