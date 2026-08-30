-- Medicine Tracker: online sync schema.
-- One authenticated identity per household (the "simple"/elder person, via
-- Google sign-in). A "supporter" never signs in — every write they make goes
-- through a SECURITY DEFINER function gated on households.share_code, a
-- standing secret they hold on their device. See docs/architecture.md.

-- ============================================================
-- 0. Extensions & helper schema
-- ============================================================
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
-- pg_net always creates its own `net` schema regardless of WITH SCHEMA, so
-- the push cron (added in Supabase's SQL editor, see supabase/README.md)
-- calls net.http_post(...), not extensions.http_post(...).
create extension if not exists pg_net;

create schema if not exists app;
revoke all on schema app from anon, authenticated;
grant usage on schema app to authenticated;

-- ============================================================
-- 1. Tables
-- ============================================================
create table public.households (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  timezone     text not null,
  share_code   text not null unique check (share_code ~ '^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$'),

  -- snapshot_through: last local date frozen for calendar display, advances
  -- ~every 15 minutes. locked_through: last local date that rejects new
  -- writes, trails snapshot_through by lock_lag_days so the offline dose-log
  -- outbox always has slack to replay into. See docs/architecture.md.
  snapshot_through date,
  locked_through   date,
  lock_lag_days    int not null default 2 check (lock_lag_days between 0 and 30),

  created_at timestamptz not null default now()
);

create table public.slots (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  label        text not null check (length(btrim(label)) between 1 and 30),
  time         time not null,
  sort_order   int  not null default 0,
  built_in     boolean not null default false,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (id, household_id)
);
create index slots_household_idx on public.slots (household_id) where not archived;

create table public.medicines (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 100),
  strength     text not null default '' check (length(strength) <= 60),
  dosage       text not null default '' check (length(dosage)   <= 60),
  form         text not null default 'tablet'
                 check (form in ('tablet','capsule','liquid','drops',
                                 'injection','inhaler','other')),
  notes        text not null default '' check (length(notes) <= 500),
  archived     boolean not null default false,
  photo_path   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, household_id)
);
create index medicines_household_idx on public.medicines (household_id);

create table public.schedules (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  medicine_id  uuid not null,
  slot_id      uuid not null,
  time         time,
  freq_type    text not null check (freq_type in ('daily','everyNDays','weekly')),
  freq_interval     int,
  freq_days_of_week smallint[],
  freq_anchor_date  date,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (id, household_id),
  foreign key (medicine_id, household_id)
    references public.medicines(id, household_id) on delete cascade,
  foreign key (slot_id, household_id)
    references public.slots(id, household_id) on delete restrict,
  -- Ports js/schedule.js's frequency shapes into the schema. A missing
  -- anchorDate on everyNDays used to make a medicine silently vanish from
  -- every screen (isDueOn treats it as "never due") -- reject the save instead.
  constraint freq_shape check (
    (freq_type = 'daily'
       and freq_interval is null and freq_days_of_week is null
       and freq_anchor_date is null)
 or (freq_type = 'everyNDays'
       and freq_interval >= 2 and freq_anchor_date is not null
       and freq_days_of_week is null)
 or (freq_type = 'weekly'
       and freq_days_of_week is not null
       and array_length(freq_days_of_week, 1) between 1 and 7
       and freq_interval is null and freq_anchor_date is null)
  ),
  constraint dow_range check (
    freq_days_of_week is null
    or freq_days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);
create index schedules_household_active_idx
  on public.schedules (household_id, slot_id) where active;

create table public.dose_log (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  medicine_id  uuid not null,
  slot_id      uuid not null,
  local_date   date not null,
  taken_at     timestamptz not null default now(),
  status       text not null default 'taken' check (status in ('taken')),
  created_at   timestamptz not null default now(),
  foreign key (medicine_id, household_id)
    references public.medicines(id, household_id) on delete restrict,
  foreign key (slot_id, household_id)
    references public.slots(id, household_id) on delete restrict,
  -- Two devices logging the same slot without coordination would otherwise
  -- create two rows for one dose; this makes the insert idempotent instead.
  unique (household_id, local_date, slot_id, medicine_id)
);
create index dose_log_day_idx on public.dose_log (household_id, local_date);

create table public.day_snapshots (
  household_id uuid not null references public.households(id) on delete cascade,
  local_date   date not null,
  slots        jsonb not null default '[]'::jsonb,
  computed_at  timestamptz not null default now(),
  primary key (household_id, local_date)
);

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth_key     text not null,
  notify_due   boolean not null default true,
  created_at   timestamptz not null default now(),
  disabled_at  timestamptz
);
create index push_subs_household_idx
  on public.push_subscriptions (household_id) where disabled_at is null;

-- Dedup for reminders. slot_time is part of the key (not just date+slot) so
-- editing a slot's time doesn't get silently deduped away with no new
-- reminder posted -- a bug already flagged in the old file-sync design.
create table app.notification_sends (
  household_id uuid not null,
  local_date   date not null,
  slot_id      uuid not null,
  slot_time    time not null,
  claimed_at   timestamptz not null default now(),
  sent_at      timestamptz,
  attempts     int not null default 0,
  primary key (household_id, local_date, slot_id, slot_time)
);
create index notification_sends_unsent_idx
  on app.notification_sends (claimed_at) where sent_at is null;

-- Realtime needs full row data on DELETE to apply RLS and to let a
-- household_id-filtered subscription match the deleted row at all --
-- otherwise Undo silently never reaches other devices.
alter table public.dose_log   replica identity full;
alter table public.medicines  replica identity full;
alter table public.schedules  replica identity full;
alter table public.slots      replica identity full;

-- Archiving a slot must deactivate any schedule still pointing at it, or a
-- medicine keeps a live schedule into a slot no screen renders.
create or replace function app.cascade_slot_archive() returns trigger
language plpgsql as $$
begin
  if new.archived and not old.archived then
    update public.schedules
       set active = false
     where household_id = new.household_id and slot_id = new.id and active;
  end if;
  return new;
end $$;
create trigger slots_archive after update of archived on public.slots
  for each row execute function app.cascade_slot_archive();

-- ============================================================
-- 2. Helper functions
-- ============================================================
create or replace function app.my_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select h.id from public.households h where h.owner_id = auth.uid();
$$;

create or replace function app.household_local_date(p_household uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone h.timezone)::date
    from public.households h where h.id = p_household;
$$;

create or replace function app.household_open_from(p_household uuid) returns date
language sql stable security definer set search_path = '' as $$
  select coalesce(h.locked_through + 1, '-infinity'::date)
    from public.households h where h.id = p_household;
$$;

create or replace function app.is_due(
  p_type text, p_interval int, p_days smallint[], p_anchor date, p_date date
) returns boolean language sql immutable as $$
  select case p_type
    when 'daily' then true
    when 'everyNDays' then
      p_anchor is not null and p_interval >= 1
      and p_date >= p_anchor and ((p_date - p_anchor) % p_interval) = 0
    when 'weekly' then
      p_days is not null and extract(dow from p_date)::smallint = any(p_days)
    else false
  end;
$$;

create or replace function app.normalize_code(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[\s-]', '', 'g'));
$$;

-- The entire trust boundary for supporter writes: resolves a household id
-- from a share code with no other identity involved. No attempt-tracking or
-- lockout -- the code space and low visibility of this app are enough at
-- this scale; add rate limiting later if it's ever actually needed.
create or replace function app.household_by_code(p_code text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.households
   where share_code = app.normalize_code(p_code);
  if v_id is null then
    raise exception 'that code is not valid' using errcode = 'P0002';
  end if;
  return v_id;
end $$;

revoke all on function app.my_household(), app.household_local_date(uuid),
  app.household_open_from(uuid), app.household_by_code(text)
  from public, anon;
grant execute on function app.my_household(), app.household_local_date(uuid),
  app.household_open_from(uuid)
  to authenticated;
grant execute on function app.household_by_code(text) to anon, authenticated;

-- ============================================================
-- 3. Grants & RLS
-- ============================================================
revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema app    from anon, authenticated;

alter table public.households         enable row level security;
alter table public.slots              enable row level security;
alter table public.medicines          enable row level security;
alter table public.schedules          enable row level security;
alter table public.dose_log           enable row level security;
alter table public.day_snapshots      enable row level security;
alter table public.push_subscriptions enable row level security;

grant select on public.households to authenticated;
grant update (display_name, timezone, lock_lag_days) on public.households to authenticated;
create policy households_select on public.households for select to authenticated
  using (owner_id = (select auth.uid()));
create policy households_update on public.households for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Routine tables: read-only for the owner (simple never edits these directly
-- in this product -- editing has only ever lived in supporter-mode screens),
-- no write grants for anyone. Every mutation goes through the SECURITY
-- DEFINER functions in §4, which resolve household_id from the share code
-- themselves rather than trusting a caller-supplied value.
grant select on public.slots, public.medicines, public.schedules to authenticated;
create policy slots_select on public.slots for select to authenticated
  using (household_id = (select app.my_household()));
create policy medicines_select on public.medicines for select to authenticated
  using (household_id = (select app.my_household()));
create policy schedules_select on public.schedules for select to authenticated
  using (household_id = (select app.my_household()));

grant select, insert, delete on public.dose_log to authenticated;
create policy dose_select on public.dose_log for select to authenticated
  using (household_id = (select app.my_household()));
create policy dose_insert on public.dose_log for insert to authenticated
  with check (
    household_id = (select app.my_household())
    and local_date <= app.household_local_date(household_id)
    and local_date >= app.household_open_from(household_id)
  );
create policy dose_delete on public.dose_log for delete to authenticated
  using (
    household_id = (select app.my_household())
    and local_date >= app.household_open_from(household_id)
  );
-- no update grant/policy: a mistake is corrected with Undo, then re-logged.

grant select on public.day_snapshots to authenticated;
create policy snapshots_select on public.day_snapshots for select to authenticated
  using (household_id = (select app.my_household()));
-- written only by the nightly freeze job (service_role bypasses RLS).

grant select, insert, update, delete on public.push_subscriptions to authenticated;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()) and household_id = (select app.my_household()))
  with check (user_id = (select auth.uid()) and household_id = (select app.my_household()));

-- ============================================================
-- 4. Code-gated function surface (supporter's entire write path)
-- ============================================================
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
                'id', id, 'name', name, 'strength', strength, 'dosage', dosage,
                'form', form, 'notes', notes, 'archived', archived, 'photoPath', photo_path))
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

create or replace function public.upsert_medicine(p_code text, p_medicine jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code); v_id uuid;
begin
  v_id := coalesce((p_medicine->>'id')::uuid, gen_random_uuid());
  insert into public.medicines (id, household_id, name, strength, dosage, form, notes)
  values (v_id, v_household, p_medicine->>'name',
          coalesce(p_medicine->>'strength', ''), coalesce(p_medicine->>'dosage', ''),
          coalesce(p_medicine->>'form', 'tablet'), coalesce(p_medicine->>'notes', ''))
  on conflict (id) do update set
    name = excluded.name, strength = excluded.strength, dosage = excluded.dosage,
    form = excluded.form, notes = excluded.notes, updated_at = now()
  where medicines.household_id = v_household
  returning jsonb_build_object('id', id, 'name', name, 'strength', strength,
    'dosage', dosage, 'form', form, 'notes', notes, 'archived', archived) into p_medicine;
  return p_medicine;
end $$;

create or replace function public.set_medicine_archived(
  p_code text, p_medicine_id uuid, p_archived boolean
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  update public.medicines set archived = p_archived, updated_at = now()
   where id = p_medicine_id and household_id = v_household;
end $$;

-- Mirrors js/store.js replaceSchedulesForMedicine: upserts what's given,
-- deactivates (never deletes) anything active but missing.
create or replace function public.replace_schedules(
  p_code text, p_medicine_id uuid, p_schedules jsonb
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
  v_row jsonb; v_kept_ids uuid[] := '{}';
  v_freq jsonb; v_id uuid;
begin
  for v_row in select * from jsonb_array_elements(p_schedules) loop
    v_freq := v_row->'frequency';
    v_id := coalesce((v_row->>'id')::uuid, gen_random_uuid());
    v_kept_ids := array_append(v_kept_ids, v_id);
    insert into public.schedules (
      id, household_id, medicine_id, slot_id, time,
      freq_type, freq_interval, freq_days_of_week, freq_anchor_date, active
    ) values (
      v_id, v_household, p_medicine_id, (v_row->>'slotId')::uuid,
      nullif(v_row->>'time', '')::time,
      v_freq->>'type',
      nullif(v_freq->>'interval', '')::int,
      case when v_freq ? 'daysOfWeek'
        then (select array_agg(x::int) from jsonb_array_elements_text(v_freq->'daysOfWeek') x)
        else null end,
      nullif(v_freq->>'anchorDate', '')::date,
      true
    )
    on conflict (id) do update set
      slot_id = excluded.slot_id, time = excluded.time,
      freq_type = excluded.freq_type, freq_interval = excluded.freq_interval,
      freq_days_of_week = excluded.freq_days_of_week, freq_anchor_date = excluded.freq_anchor_date,
      active = true
    where schedules.household_id = v_household and schedules.medicine_id = p_medicine_id;
  end loop;

  update public.schedules set active = false
   where household_id = v_household and medicine_id = p_medicine_id
     and active and not (id = any(v_kept_ids));
end $$;

-- Replaces the slot set; anything missing from p_slots gets archived (the
-- cascade_slot_archive trigger then deactivates its schedules).
create or replace function public.save_slots(p_code text, p_slots jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
  v_row jsonb; v_kept_ids uuid[] := '{}'; v_id uuid;
begin
  for v_row in select * from jsonb_array_elements(p_slots) loop
    v_id := coalesce((v_row->>'id')::uuid, gen_random_uuid());
    v_kept_ids := array_append(v_kept_ids, v_id);
    insert into public.slots (id, household_id, label, time, sort_order, built_in, archived)
    values (v_id, v_household, v_row->>'label', (v_row->>'time')::time,
            coalesce((v_row->>'order')::int, 0), coalesce((v_row->>'builtIn')::boolean, false), false)
    on conflict (id) do update set
      label = excluded.label, time = excluded.time, sort_order = excluded.sort_order,
      archived = false
    where slots.household_id = v_household;
  end loop;

  update public.slots set archived = true
   where household_id = v_household and not archived and not (id = any(v_kept_ids));
end $$;

-- Owner-only, no code parameter -- a supporter (code only, no session) can
-- never call this, which is what makes rotation simple-only.
create or replace function public.rotate_share_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_code text;
begin
  if app.my_household() is null then
    raise exception 'not signed in to a household' using errcode = '42501';
  end if;
  loop
    v_code := (select string_agg(substr(alphabet, (get_byte(extensions.gen_random_bytes(1), 0) % 30) + 1, 1), '')
               from generate_series(1, 6), (select '23456789ABCDEFGHJKMNPQRSTVWXYZ' as alphabet) a);
    begin
      update public.households set share_code = v_code where id = app.my_household();
      return v_code;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

create or replace function public.create_household(
  p_display_name text, p_timezone text
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
      insert into public.households (owner_id, display_name, timezone, share_code)
      values (auth.uid(), btrim(p_display_name), p_timezone, v_code)
      returning id into v_id;
      exit;
    exception when unique_violation then null;
    end;
  end loop;

  insert into public.slots (household_id, label, time, sort_order, built_in) values
    (v_id, 'Morning', '08:00', 1, true), (v_id, 'Afternoon', '13:00', 2, true),
    (v_id, 'Evening', '18:00', 3, true), (v_id, 'Night', '21:00', 4, true);

  v_today := app.household_local_date(v_id);
  update public.households
     set snapshot_through = v_today - 1, locked_through = v_today - 1 - lock_lag_days
   where id = v_id;
  return v_id;
end $$;

revoke all on function public.get_routine(text), public.upsert_medicine(text, jsonb),
  public.set_medicine_archived(text, uuid, boolean), public.replace_schedules(text, uuid, jsonb),
  public.save_slots(text, jsonb), public.rotate_share_code(), public.create_household(text, text)
  from public, anon;
grant execute on function public.get_routine(text), public.upsert_medicine(text, jsonb),
  public.set_medicine_archived(text, uuid, boolean), public.replace_schedules(text, uuid, jsonb),
  public.save_slots(text, jsonb) to anon, authenticated;
grant execute on function public.rotate_share_code(), public.create_household(text, text)
  to authenticated;

-- ============================================================
-- 5. Storage (photos)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('med-photos', 'med-photos', false, 512000, array['image/jpeg'])
on conflict (id) do nothing;

-- Only simple's authenticated client reads directly (to show photos on
-- Today/Calendar). Supporter has no session, so their reads/writes go
-- through the supporter-photo Edge Function using service_role instead --
-- no anon policy needed here at all.
create policy photos_select on storage.objects for select to authenticated
  using (bucket_id = 'med-photos'
         and (nullif((storage.foldername(name))[1], '')::uuid) = (select app.my_household()));

-- ============================================================
-- 6. Nightly freeze
-- ============================================================
create or replace function app.compute_day(p_household uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with due as (
    select sl.id as slot_id, sl.label, coalesce(sc.time, sl.time) as t,
           m.id as medicine_id, m.name, m.strength, m.dosage, m.notes, m.form
      from public.schedules sc
      join public.slots sl on sl.id = sc.slot_id and sl.household_id = sc.household_id
      join public.medicines m on m.id = sc.medicine_id and m.household_id = sc.household_id
     where sc.household_id = p_household and sc.active
       and not m.archived and not sl.archived
       and app.is_due(sc.freq_type, sc.freq_interval, sc.freq_days_of_week, sc.freq_anchor_date, p_date)
  ),
  per_slot as (
    select slot_id, min(label) as label, min(t) as t,
           jsonb_agg(distinct jsonb_build_object(
             'medicineId', medicine_id, 'name', name, 'strength', strength,
             'dosage', dosage, 'notes', notes, 'form', form)) as medicines
      from due group by slot_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'slotId', slot_id, 'label', label, 'time', to_char(t, 'HH24:MI'), 'medicines', medicines
         ) order by t), '[]'::jsonb)
    from per_slot;
$$;

create or replace function app.run_daily_freeze() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare h record; d date; from_date date; n int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('medtrack.freeze')) then
    return 0;
  end if;
  for h in
    select id, snapshot_through, locked_through, lock_lag_days,
           (now() at time zone timezone)::date as local_today
      from public.households
  loop
    if h.snapshot_through is not null and h.snapshot_through >= h.local_today - 1 then
      continue;
    end if;
    from_date := greatest(coalesce(h.snapshot_through + 1, h.local_today - 1), h.local_today - 400);
    d := from_date;
    while d <= h.local_today - 1 loop
      insert into public.day_snapshots (household_id, local_date, slots)
      values (h.id, d, app.compute_day(h.id, d))
      on conflict (household_id, local_date) do nothing;
      d := d + 1;
      n := n + 1;
    end loop;
    update public.households
       set snapshot_through = greatest(coalesce(snapshot_through, '-infinity'), h.local_today - 1),
           locked_through   = greatest(coalesce(locked_through, '-infinity'), h.local_today - 1 - lock_lag_days)
     where id = h.id;
  end loop;
  return n;
end $$;

select cron.schedule('medtrack-freeze', '*/15 * * * *', $$select app.run_daily_freeze()$$);

-- ============================================================
-- 7. Push reminders
-- ============================================================
create or replace function app.claim_due_notifications(
  p_grace interval default '20 minutes', p_retry interval default '4 minutes'
) returns table (
  subscription_id uuid, endpoint text, p256dh text, auth_key text, slot_label text,
  household_id uuid, local_date date, slot_id uuid, slot_time time
)
language sql volatile security definer set search_path = '' as $$
  with hh as (
    select h.id, h.timezone, (now() at time zone h.timezone)::date as today from public.households h
  ),
  cand as (
    select hh.id as household_id, hh.timezone, d.local_date
      from hh cross join lateral (values (hh.today), (hh.today - 1)) as d(local_date)
  ),
  due_slots as (
    select c.household_id, c.local_date, c.timezone, sl.id as slot_id, sl.label,
           coalesce(min(sc.time), sl.time) as fire_time
      from cand c
      join public.schedules sc on sc.household_id = c.household_id and sc.active
      join public.slots sl on sl.id = sc.slot_id and sl.household_id = sc.household_id and not sl.archived
      join public.medicines m on m.id = sc.medicine_id and m.household_id = sc.household_id and not m.archived
     where app.is_due(sc.freq_type, sc.freq_interval, sc.freq_days_of_week, sc.freq_anchor_date, c.local_date)
     group by c.household_id, c.local_date, c.timezone, sl.id, sl.label, sl.time
  ),
  fired as (
    select d.* from due_slots d
     where now() >= ((d.local_date + d.fire_time) at time zone d.timezone)
       and now() <  ((d.local_date + d.fire_time) at time zone d.timezone) + p_grace
  ),
  unlogged as (
    select f.* from fired f
     where exists (
       select 1 from public.schedules sc
         join public.medicines m on m.id = sc.medicine_id and m.household_id = sc.household_id and not m.archived
        where sc.household_id = f.household_id and sc.slot_id = f.slot_id and sc.active
          and app.is_due(sc.freq_type, sc.freq_interval, sc.freq_days_of_week, sc.freq_anchor_date, f.local_date)
          and not exists (
            select 1 from public.dose_log dl
             where dl.household_id = f.household_id and dl.local_date = f.local_date
               and dl.slot_id = f.slot_id and dl.medicine_id = sc.medicine_id)
     )
  ),
  claimed as (
    insert into app.notification_sends (household_id, local_date, slot_id, slot_time, attempts)
    select household_id, local_date, slot_id, fire_time, 1 from unlogged
    on conflict (household_id, local_date, slot_id, slot_time) do update
      set attempts = app.notification_sends.attempts + 1, claimed_at = now()
      where app.notification_sends.sent_at is null
        and app.notification_sends.attempts < 3
        and app.notification_sends.claimed_at < now() - p_retry
    returning household_id, slot_id, local_date
  )
  select ps.id, ps.endpoint, ps.p256dh, ps.auth_key, u.label,
         c.household_id, c.local_date, c.slot_id, u.fire_time
    from claimed c
    join unlogged u on u.household_id = c.household_id and u.slot_id = c.slot_id and u.local_date = c.local_date
    join public.push_subscriptions ps
      on ps.household_id = c.household_id and ps.disabled_at is null and ps.notify_due;
$$;

create or replace function app.mark_notification_sent(
  p_household uuid, p_date date, p_slot uuid, p_time time
) returns void
language sql volatile security definer set search_path = '' as $$
  update app.notification_sends set sent_at = now()
   where household_id = p_household and local_date = p_date and slot_id = p_slot and slot_time = p_time;
$$;

create or replace function app.disable_push_subscription(p_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.push_subscriptions set disabled_at = now() where id = p_id;
$$;

select cron.schedule('medtrack-prune', '17 3 * * *', $$
  delete from app.notification_sends where claimed_at < now() - interval '30 days';
$$);

-- The push cron (calling the send-reminders Edge Function every 5 minutes)
-- is scheduled from the Supabase dashboard at deploy time, not here, so the
-- service-role key it needs never has to live in a committed migration file.
