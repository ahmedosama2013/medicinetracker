-- A plain history of every push the app sends: one row per device per send,
-- with the exact words shown and whether delivery worked.
--
-- The *_sends tables (notification_sends, escalation_sends,
-- daily_summary_sends) exist to stop duplicates, not to record history: they
-- hold one row per household (or per subscription) per slot, never the text,
-- never which phones a household-wide message reached, and nothing at all
-- for nudges or test sends. Answering "what did the supporter get at 8 pm?"
-- took three joined queries and still had to guess the wording. This is the
-- table that answers it directly. The *_sends tables stay as they are.
--
-- Written only by the Edge Functions (service role), through log_push()
-- below. A failed log write never blocks or retries a notification -- see
-- supabase/functions/_shared/push-log.ts.

create table if not exists app.push_log (
  id              bigint generated always as identity primary key,
  sent_at         timestamptz not null default now(),
  household_id    uuid not null references public.households(id) on delete cascade,
  -- Kept when a subscription is later removed, so the history survives.
  subscription_id uuid references public.push_subscriptions(id) on delete set null,
  role            text,           -- 'patient' or 'supporter'
  kind            text not null,  -- reminder, follow-up, escalation, nightly, nudge, test
  local_date      date,           -- the household's date, for slot and nightly messages
  slot_id         uuid,
  title           text not null,
  body            text not null,
  ok              boolean not null,
  status_code     int,            -- the push service's HTTP status on failure
  error           text
);

create index if not exists push_log_household_idx
  on app.push_log (household_id, sent_at desc);

-- ============================================================
-- Writing a row: Edge Functions only.
-- ============================================================

-- PostgREST does not expose the app schema, so the functions reach the table
-- through this public wrapper, same as mark_notification_sent and friends.
create or replace function public.log_push(
  p_household    uuid,
  p_subscription uuid,
  p_role         text,
  p_kind         text,
  p_title        text,
  p_body         text,
  p_ok           boolean,
  p_status_code  int  default null,
  p_error        text default null,
  p_local_date   date default null,
  p_slot         uuid default null
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into app.push_log
    (household_id, subscription_id, role, kind, title, body, ok,
     status_code, error, local_date, slot_id)
  values
    (p_household, p_subscription, p_role, p_kind, p_title, p_body, p_ok,
     p_status_code, left(p_error, 300), p_local_date, p_slot);
$$;

revoke all on function public.log_push(uuid, uuid, text, text, text, text, boolean, int, text, date, uuid)
  from public, anon, authenticated;
grant execute on function public.log_push(uuid, uuid, text, text, text, text, boolean, int, text, date, uuid)
  to service_role;

-- ============================================================
-- Keep 90 days. Same shape as medtrack-prune in 0001.
-- ============================================================

select cron.schedule('medtrack-push-log-prune', '27 3 * * *', $$
  delete from app.push_log where sent_at < now() - interval '90 days';
$$);
