-- Morning and Night go in the box by default.
--
-- 0012 added slots.in_box with `default false` and then backfilled Morning and
-- Night (sort_order 1 and 4) for the households that existed at the time. What
-- it did not do is teach create_household to seed them, so every household
-- created since 0012 has started with an EMPTY box: the organiser opens on
-- "No times of day go in the pill box yet" and the person has to go and tick
-- something before the feature does anything at all.
--
-- The default belongs here rather than in the client. js/store.js's
-- DEFAULT_SLOTS already marks morning and night, but that list is only the
-- placeholder shown before the first sync lands -- the moment real slots
-- arrive from Postgres they replace it, flags included. One physical box, one
-- source of truth (see 0012's note on why this is household state).

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

  -- in_box matches 0012's backfill: the two ends of the day, which is the
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

revoke all on function public.create_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;

-- Households created between 0012 and this migration have an empty box and no
-- way to have chosen otherwise, since the organiser refuses to open without at
-- least one slot ticked. Seed those, and only those: the `not exists` guard
-- means a household that has ticked anything at all -- including one that has
-- deliberately ticked a single slot -- is left exactly as it is.
update public.slots s set in_box = true
 where s.built_in and not s.archived and s.sort_order in (1, 4)
   and not exists (
     select 1 from public.slots o
      where o.household_id = s.household_id and o.in_box and not o.archived
   );
