-- Shared medicine references. This table intentionally contains no household,
-- supporter, schedule, dosage quantity, notes, or treatment data.
create table if not exists public.community_medicine_references (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  name_search text not null,
  strength text not null default '' check (length(strength) <= 60),
  strength_search text not null,
  pill_photo_path text,
  packet_photo_path text,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  unique (name_search, strength_search)
);
create index if not exists community_medicine_name_search_idx
  on public.community_medicine_references (name_search);
alter table public.community_medicine_references enable row level security;
revoke all on public.community_medicine_references from anon, authenticated;

create table if not exists public.community_photo_suggestions (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.community_medicine_references(id) on delete restrict,
  kind text not null check (kind in ('pill', 'packet')),
  photo_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 240)
);
alter table public.community_photo_suggestions enable row level security;
revoke all on public.community_photo_suggestions from anon, authenticated;
alter table public.medicines add column if not exists community_reference_id uuid;
alter table public.medicines drop constraint if exists medicines_community_reference_id_fkey;
alter table public.medicines add constraint medicines_community_reference_id_fkey
  foreign key (community_reference_id)
  references public.community_medicine_references(id) on delete restrict;

grant select on public.community_medicine_references to authenticated;
create policy community_refs_linked_select on public.community_medicine_references for select to authenticated
  using (exists (select 1 from public.medicines m where m.household_id = app.my_household() and m.community_reference_id = id));

create or replace function app.normalize_catalog_text(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\\s+', ' ', 'g'));
$$;

create or replace function public.upsert_medicine(p_code text, p_medicine jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code); v_id uuid; v_ref uuid;
begin
  v_id := coalesce((p_medicine->>'id')::uuid, gen_random_uuid());
  v_ref := nullif(p_medicine->>'communityReferenceId', '')::uuid;
  if v_ref is not null and not exists (
    select 1 from public.community_medicine_references
    where id = v_ref and status = 'active'
  ) then raise exception 'that community reference is not available'; end if;
  insert into public.medicines (id, household_id, name, strength, dose_qty, form, notes, purpose, community_reference_id)
  values (v_id, v_household, p_medicine->>'name', coalesce(p_medicine->>'strength',''),
    coalesce((p_medicine->>'doseQty')::numeric, 1), coalesce(p_medicine->>'form','tablet'),
    coalesce(p_medicine->>'notes',''), coalesce(p_medicine->>'purpose',''), v_ref)
  on conflict (id) do update set name=excluded.name, strength=excluded.strength,
    dose_qty=excluded.dose_qty, form=excluded.form, notes=excluded.notes,
    purpose=excluded.purpose, community_reference_id=excluded.community_reference_id,
    updated_at=now() where medicines.household_id=v_household
  returning jsonb_build_object('id',id,'name',name,'strength',strength,'doseQty',dose_qty,
    'form',form,'notes',notes,'purpose',purpose,'archived',archived,
    'photoPath',photo_path,'packetPhotoPath',packet_photo_path,
    'communityReferenceId',community_reference_id) into p_medicine;
  return p_medicine;
end $$;

grant execute on function app.normalize_catalog_text(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-med-photos', 'community-med-photos', false, 512000, array['image/jpeg'])
on conflict (id) do nothing;


create or replace function public.get_routine(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_household uuid := app.household_by_code(p_code);
begin
  return jsonb_build_object(
    'household', (select jsonb_build_object('displayName', display_name, 'timezone', timezone) from public.households where id = v_household),
    'slots', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'time', to_char(time, 'HH24:MI'), 'order', sort_order, 'builtIn', built_in) order by sort_order) from public.slots where household_id = v_household and not archived), '[]'::jsonb),
    'medicines', coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'strength',m.strength,'doseQty',m.dose_qty,'form',m.form,'notes',m.notes,'purpose',m.purpose,'archived',m.archived,'photoPath',m.photo_path,'packetPhotoPath',m.packet_photo_path,'communityReferenceId',m.community_reference_id,'communityReferenceName',r.name,'communityReferenceStrength',r.strength,'communityPillPhotoPath',r.pill_photo_path,'communityPacketPhotoPath',r.packet_photo_path)) from public.medicines m left join public.community_medicine_references r on r.id=m.community_reference_id where m.household_id=v_household), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(jsonb_build_object('id',id,'medicineId',medicine_id,'slotId',slot_id,'time',to_char(time,'HH24:MI'),'active',active,'frequency',jsonb_build_object('type',freq_type,'interval',freq_interval,'daysOfWeek',freq_days_of_week,'anchorDate',freq_anchor_date))) from public.schedules where household_id=v_household and active), '[]'::jsonb)
  );
end $$;


create or replace function app.lock_community_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.community_reference_id is not null then
    select name, strength into r from public.community_medicine_references
      where id = new.community_reference_id and status = 'active';
    if not found or btrim(new.name) <> r.name or coalesce(new.strength, '') <> r.strength then
      raise exception 'community medicine name and strength cannot be changed';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.community_reference_id is not null and
     (new.community_reference_id is distinct from old.community_reference_id
      or btrim(new.name) <> old.name or coalesce(new.strength, '') <> old.strength) then
    raise exception 'community medicine name and strength cannot be changed';
  end if;
  return new;
end $$;

drop trigger if exists medicines_community_identity on public.medicines;
create trigger medicines_community_identity before insert or update of name, strength, community_reference_id
  on public.medicines for each row execute function app.lock_community_identity();
