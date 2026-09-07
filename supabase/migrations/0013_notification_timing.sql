-- Per-household notification timing.
--
-- Until now the follow-up delay was a DEFAULT ON A FUNCTION ARGUMENT
-- (`p_followup interval default '45 minutes'` in 0004), which means every
-- household on the project shared one value and changing it needed a
-- migration. These two columns move the decision to the household row.
--
-- WHY NO UI, AND NO UPDATE GRANT
--
-- Same reasoning as `lock_lag_days` in 0001: a knob worth having and not
-- worth a settings screen. Nothing in js/ reads or writes either column, and
-- deliberately no `grant update` is issued -- so the RLS surface is unchanged
-- and neither value becomes client-writable. To change one, run SQL:
--
--   update public.households set followup_after = '90 minutes' where id = '...';
--
-- The elder's Settings screen stays a single on/off switch, which is the
-- whole point of simple mode.
--
-- AN INVARIANT THAT CANNOT BE A CONSTRAINT
--
-- `p_grace` (how long after its own time a stage-1 reminder stays eligible to
-- fire, 30 minutes as of 0014) must stay comfortably below `followup_after`.
-- It is a function argument, not a column, so Postgres cannot check this.
-- With a 45-minute grace and a 60-minute follow-up, a stage 1 that fires late
-- at 09:44 is chased by stage 2 at 10:00 -- two buzzes sixteen minutes apart.
-- If you raise the grace, raise this too.

alter table public.households
  add column if not exists followup_after interval not null default '1 hour'
    check (followup_after between interval '15 minutes' and interval '12 hours'),
  -- Bounded to the evening: this doubles as the cutoff past which a stage-2
  -- follow-up is suppressed in favour of the nightly summary (see 0014), and
  -- a cutoff earlier than 20:00 would silently cancel evening follow-ups.
  add column if not exists nightly_summary_time time not null default '23:50'
    check (nightly_summary_time between time '20:00' and time '23:59');

comment on column public.households.followup_after is
  'How long after a slot''s own time the single stage-2 follow-up fires. SQL-only, no UI.';
comment on column public.households.nightly_summary_time is
  'Local time of the nightly catch-all, and the cutoff past which stage 2 is suppressed. SQL-only, no UI.';
