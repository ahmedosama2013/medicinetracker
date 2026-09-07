-- A supporter device can now hold a push subscription too, with no login of
-- any kind -- the same trust model as every other supporter write in this
-- app, extended to one more table.
--
-- VOCABULARY: this column uses 'patient'/'supporter', matching the existing
-- dose_log.logged_by check (0006_supporter_parity.sql), not 'elder'/'simple'
-- (the words used elsewhere in SQL and in js/, respectively). Three words for
-- one side of this app already exist across the layers; this at least keeps
-- the SQL layer internally consistent rather than adding a fourth.

-- ============================================================
-- 1. push_subscriptions: user_id becomes optional, role distinguishes the two
-- ============================================================
-- user_id was `not null references auth.users(id)` -- correct as long as
-- every subscriber had a Supabase session. A supporter never does, so a
-- supporter row can supply no user_id at all. The shape constraint keeps the
-- two kinds from being confused: a 'patient' row must still carry a user_id
-- (nothing about the elder's own path changes), a 'supporter' row must not.
alter table public.push_subscriptions
  alter column user_id drop not null,
  add column if not exists role text not null default 'patient'
    check (role in ('patient', 'supporter')),
  -- Per SUBSCRIPTION, not per household: two supporters on the same elder
  -- can each pick their own patience. Sits on every row (unused, harmless
  -- default on 'patient' rows) rather than a side table -- this table
  -- already carries per-row behavioural flags (notify_due), so one more is
  -- the existing shape, not a new one. The four values are exactly the
  -- supporter's picker options in Settings; nothing in this app constructs
  -- an arbitrary interval here.
  add column if not exists escalation_after interval not null default '1 hour'
    check (escalation_after in
      (interval '30 minutes', interval '1 hour', interval '2 hours', interval '3 hours')),
  add constraint push_subscriptions_shape check (
    (role = 'patient'   and user_id is not null)
 or (role = 'supporter' and user_id is null)
  );

comment on column public.push_subscriptions.role is
  'patient (has a Supabase session, writes this row itself) or supporter (no session, written only via subscribe_push/unsubscribe_push below).';
comment on column public.push_subscriptions.escalation_after is
  'Supporter rows only: delay after households.followup_after before app.claim_supporter_escalations considers this subscription. One of 4 fixed values, set from Settings.';

-- The existing push_own RLS policy and its authenticated-only grant are
-- untouched below this line -- they still govern the elder's own direct
-- writes via js/push.js exactly as before. A supporter row is never reached
-- by that policy at all: anon has no grant on this table, on purpose, same
-- as every other table a supporter touches. The four functions below are the
-- only door in, exactly like get_routine/upsert_medicine/set_slot_in_box.

-- ============================================================
-- 2. The supporter's entire push surface: four code-gated functions
-- ============================================================
-- Defined directly in `public`, not app-wrapped-by-public. That split exists
-- for the reminder claim functions because THEY must never be callable by
-- anon (they return live push endpoints and encryption keys for every
-- household with something due). These four are the opposite case: they are
-- MEANT to be callable by anon, with share_code as the entire security
-- boundary -- the same shape as get_routine, upsert_medicine, and every other
-- function in the "Code-gated function surface" section of 0001_init.sql.

-- Upsert-on-endpoint-conflict, matching js/push.js's own subscribe(): the
-- same browser subscribing again -- under this code or a different one --
-- always overwrites the previous owner of that endpoint in place. That is
-- already true for the elder's own path and for a browser that switches
-- which supporter code it's connected to; this does not add a new failure
-- mode, it is the existing one, now reachable from a second entry point.
create or replace function public.subscribe_push(
  p_code text, p_endpoint text, p_p256dh text, p_auth_key text,
  p_escalation_after interval default '1 hour'
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.push_subscriptions
    (household_id, user_id, role, endpoint, p256dh, auth_key, escalation_after, disabled_at)
  values
    (app.household_by_code(p_code), null, 'supporter', p_endpoint, p_p256dh, p_auth_key,
     p_escalation_after, null)
  on conflict (endpoint) do update set
    household_id     = excluded.household_id,
    role              = 'supporter',
    user_id           = null,
    p256dh            = excluded.p256dh,
    auth_key          = excluded.auth_key,
    escalation_after  = excluded.escalation_after,
    disabled_at       = null;
$$;

create or replace function public.unsubscribe_push(p_code text, p_endpoint text) returns void
language sql volatile security definer set search_path = '' as $$
  delete from public.push_subscriptions
   where endpoint = p_endpoint and household_id = app.household_by_code(p_code)
     and role = 'supporter';
$$;

-- Zero or one row, never an error for "not subscribed" -- the client reads
-- an empty result as "off", the same convention js/push.js's isSubscribed()
-- already uses for the elder's own toggle.
create or replace function public.push_subscription_status(p_code text, p_endpoint text)
returns table (escalation_after interval)
language sql stable security definer set search_path = '' as $$
  select ps.escalation_after from public.push_subscriptions ps
   where ps.endpoint = p_endpoint and ps.household_id = app.household_by_code(p_code)
     and ps.role = 'supporter' and ps.disabled_at is null;
$$;

-- Separate from subscribe_push so changing the delay in Settings never
-- re-triggers a permission prompt or a browser-level re-subscribe.
create or replace function public.set_push_escalation(
  p_code text, p_endpoint text, p_escalation_after interval
) returns void
language sql volatile security definer set search_path = '' as $$
  update public.push_subscriptions set escalation_after = p_escalation_after
   where endpoint = p_endpoint and household_id = app.household_by_code(p_code)
     and role = 'supporter';
$$;

revoke all on function
  public.subscribe_push(text, text, text, text, interval),
  public.unsubscribe_push(text, text),
  public.push_subscription_status(text, text),
  public.set_push_escalation(text, text, interval)
  from public;

grant execute on function
  public.subscribe_push(text, text, text, text, interval),
  public.unsubscribe_push(text, text),
  public.push_subscription_status(text, text),
  public.set_push_escalation(text, text, interval)
  to anon, authenticated;
