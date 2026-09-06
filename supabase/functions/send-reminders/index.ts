// Cron-triggered (see README in this directory for the pg_cron setup step).
// Every decision about *what* to send already happened in
// app.claim_due_notifications() -- this function just delivers.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

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

Deno.serve(async () => {
  const vapidError = ensureVapid()
  if (vapidError) return new Response(`push not configured: ${vapidError}`, { status: 500 })

  const { data, error } = await supabase.rpc('claim_due_notifications')
  if (error) return new Response(error.message, { status: 500 })

  for (const row of data ?? []) {
    try {
      // Never put a medicine name here: it passes through a third-party push
      // service and can land on a lock screen. Stage 2 is the one follow-up
      // sent if the slot is still unmarked a while after stage 1 -- see
      // app.claim_due_notifications for the "still unmarked" logic itself;
      // this only varies the wording so the second message doesn't read as
      // a duplicate of the first.
      const body = row.stage === 2
        ? `Still time for your ${row.slot_label} medicines`
        : `Time for your ${row.slot_label} medicines`

      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } },
        JSON.stringify({ title: 'Medicine Tracker', body }),
      )
      await supabase.rpc('mark_notification_sent', {
        p_household: row.household_id,
        p_date: row.local_date,
        p_slot: row.slot_id,
        p_time: row.slot_time,
        p_stage: row.stage,
      })
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabase.rpc('disable_push_subscription', { p_id: row.subscription_id })
      }
      // otherwise leave it unclaimed for the next run's stale-reclaim
    }
  }

  return new Response('ok')
})
