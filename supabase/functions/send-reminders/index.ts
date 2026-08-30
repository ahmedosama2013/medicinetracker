// Cron-triggered (see README in this directory for the pg_cron setup step).
// Every decision about *what* to send already happened in
// app.claim_due_notifications() -- this function just delivers.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

webpush.setVapidDetails(
  `mailto:${Deno.env.get('VAPID_CONTACT_EMAIL')}`,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

Deno.serve(async () => {
  const { data, error } = await supabase.rpc('claim_due_notifications')
  if (error) return new Response(error.message, { status: 500 })

  for (const row of data ?? []) {
    try {
      // Never put a medicine name here: it passes through a third-party push
      // service and can land on a lock screen.
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } },
        JSON.stringify({
          title: 'Medicine Tracker',
          body: `Time for your ${row.slot_label} medicines`,
        }),
      )
      await supabase.rpc('mark_notification_sent', {
        p_household: row.household_id,
        p_date: row.local_date,
        p_slot: row.slot_id,
        p_time: row.slot_time,
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
