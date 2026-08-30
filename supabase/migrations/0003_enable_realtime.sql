-- js/sync.js subscribes to postgres_changes on these tables so the elder's
-- device updates live when the supporter makes a change. Postgres Changes
-- only fires for tables added to the supabase_realtime publication -- this
-- was never done, so the subscription silently received nothing.
alter publication supabase_realtime add table
  public.medicines,
  public.schedules,
  public.slots,
  public.dose_log,
  public.day_snapshots,
  public.households;
