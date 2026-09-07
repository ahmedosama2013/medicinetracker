// Cron-triggered (see README in this directory for the pg_cron setup step).
// Every decision about *what* to send already happened in Postgres -- this
// function just delivers. Two claims, in one function on one cron:
//
//   claim_due_notifications  slot reminders, stage 1 at the slot's time and
//                            stage 2 an hour later (0014)
//   claim_daily_summary      the nightly catch-all at ~23:50 (0015)
//
// One function rather than two because they share everything that is
// awkward: the VAPID bootstrap, the dead-endpoint cleanup, a deploy step and
// a cron entry. Neither claim knows the other exists.
//
// No wording lives in this file. See ../_shared/messages.ts and the four
// rules at the top of it.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { nightlyNotification, slotNotification } from '../_shared/messages.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

/* VAPID is configured on first use, not at module load. See the same block
 * in ../nudge/index.ts.
 *
 * This used to be a bare setVapidDetails() at the top level. When it throws --
 * a missing secret, a malformed key -- the whole worker dies before it can
 * answer anything, including the CORS preflight. From a browser that is
 * indistinguishable from the function not existing, and from cron it is a
 * silent no-op. A configuration problem should produce a message, not a
 * disappearance. */
let vapidReady: boolean | string = false

function ensureVapid(): string | null {
  if (vapidReady === true) return null
  if (typeof vapidReady === 'string') return vapidReady

  const email = Deno.env.get('VAPID_CONTACT_EMAIL')
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')

  const missing = [
    !email && 'VAPID_CONTACT_EMAIL',
    !pub && 'VAPID_PUBLIC_KEY',
    !priv && 'VAPID_PRIVATE_KEY',
  ].filter(Boolean)
  if (missing.length) {
    vapidReady = `missing secrets: ${missing.join(', ')}`
    return vapidReady as string
  }

  try {
    webpush.setVapidDetails(`mailto:${email}`, pub!, priv!)
    vapidReady = true
    return null
  } catch (err) {
    vapidReady = `VAPID keys rejected: ${String((err as Error)?.message ?? err)}`
    return vapidReady as string
  }
}

/* The shape both claims return: enough to push to one device. */
interface PushTarget {
  subscription_id: string
  endpoint: string
  p256dh: string
  auth_key: string
}

/**
 * Deliver one notification. Returns whether it actually went out, so the
 * caller only marks a row sent when it was.
 *
 * A 404 or 410 from the push service means the endpoint is gone for good --
 * the app was uninstalled, or the browser rotated its subscription -- so the
 * row is disabled rather than retried forever. Any other failure is left
 * unmarked for the next run's stale-reclaim.
 */
async function deliver(target: PushTarget, title: string, body: string): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth_key } },
      JSON.stringify({ title, body }),
    )
    return true
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 404 || status === 410) {
      await supabase.rpc('disable_push_subscription', { p_id: target.subscription_id })
    }
    return false
  }
}

Deno.serve(async () => {
  const vapidError = ensureVapid()
  if (vapidError) return new Response(`push not configured: ${vapidError}`, { status: 500 })

  /* The two claims run independently and both failures are collected rather
   * than returned early. An earlier version returned 500 the moment a claim
   * errored, which -- once there were two of them -- would have meant a
   * broken slot-reminder query silently cancelling that night's summary as
   * well. One failing job should not take the other down with it. */
  const problems: string[] = []
  let sent = 0

  // ---- slot reminders, stage 1 and stage 2 --------------------------------
  const { data: due, error: dueError } = await supabase.rpc('claim_due_notifications')
  if (dueError) problems.push(`claim_due_notifications: ${dueError.message}`)

  for (const row of due ?? []) {
    const { title, body } = slotNotification(
      row.stage, row.slot_label, row.local_date, row.slot_id,
    )
    if (await deliver(row, title, body)) {
      sent += 1
      await supabase.rpc('mark_notification_sent', {
        p_household: row.household_id,
        p_date: row.local_date,
        p_slot: row.slot_id,
        p_time: row.slot_time,
        p_stage: row.stage,
      })
    }
  }

  // ---- the nightly catch-all ----------------------------------------------
  const { data: summaries, error: summaryError } = await supabase.rpc('claim_daily_summary')
  if (summaryError) problems.push(`claim_daily_summary: ${summaryError.message}`)

  for (const row of summaries ?? []) {
    const { title, body } = nightlyNotification(row.local_date, row.household_id)
    if (await deliver(row, title, body)) {
      sent += 1
      await supabase.rpc('mark_daily_summary_sent', {
        p_household: row.household_id,
        p_date: row.local_date,
      })
    }
  }

  /* Reporting the count, not a bare "ok": these logs are the only window into
   * a job nobody watches, and "sent 0" on an evening when something was due
   * is the signal worth being able to see. */
  if (problems.length) {
    return new Response(`sent ${sent}; ${problems.join('; ')}`, { status: 500 })
  }
  return new Response(`ok, sent ${sent}`)
})
