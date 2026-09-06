// A supporter asking "have you taken them?" without phoning.
//
// This replaces the actual current behaviour, which is a phone call. It is one
// button, and everything about it is shaped by the fact that the person on the
// receiving end did not ask to be nudged.
//
// Three rules it enforces:
//
//   1. It never names a medicine. Same reason send-reminders doesn't: the body
//      passes through a third-party push service and lands on a lock screen.
//   2. It is rate limited server-side, not in the UI. A worried relative
//      tapping four times must not produce four buzzes, and client-side
//      limiting is a suggestion rather than a limit.
//   3. It goes only to the household that owns the share code, and only to
//      subscriptions that opted into notifications at all.
//
// A supporter device has no Supabase session, so the code is the only
// credential -- validated the same way as supporter-photo does.
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** One nudge per household per this many minutes, whatever the UI does. */
const COOLDOWN_MINUTES = 60

async function householdIdForCode(code: string): Promise<string> {
  const normalized = (code ?? '').toUpperCase().replace(/[\s-]/g, '')
  const { data, error } = await supabase
    .from('households')
    .select('id')
    .eq('share_code', normalized)
    .single()
  if (error || !data) throw new Error('that code is not valid')
  return data.id as string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { code } = await req.json()
    const householdId = await householdIdForCode(code)

    /* The cooldown is recorded on the household row rather than in a new
     * table: there is exactly one value to keep and it has no history worth
     * having. `last_nudge_at` is added by migration 0007. */
    const { data: household } = await supabase
      .from('households')
      .select('last_nudge_at')
      .eq('id', householdId)
      .single()

    const last = household?.last_nudge_at ? Date.parse(household.last_nudge_at) : 0
    const waitMs = COOLDOWN_MINUTES * 60_000 - (Date.now() - last)
    if (waitMs > 0) {
      return Response.json(
        { sent: 0, retryInMinutes: Math.ceil(waitMs / 60_000) },
        { status: 429, headers: corsHeaders },
      )
    }

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .eq('household_id', householdId)
      .eq('notify_due', true)
      .is('disabled_at', null)

    if (!subs?.length) {
      // Distinguished from a delivered nudge on purpose: the supporter needs
      // to know reminders were never turned on, or they will assume silence
      // means the message arrived and was ignored.
      return Response.json({ sent: 0, reason: 'no-subscriptions' }, { headers: corsHeaders })
    }

    let sent = 0
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify({
            title: 'Medicine Tracker',
            // Deliberately not "you forgot": the supporter cannot see whether
            // the dose was taken and simply not marked, and this app never
            // reads as judgement (docs/ui.md).
            body: 'A quick check on your medicines',
          }),
        )
        sent += 1
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.rpc('disable_push_subscription', { p_id: sub.id })
        }
      }
    }

    // Only on success: a nudge that reached nobody must not burn the cooldown.
    if (sent > 0) {
      await supabase
        .from('households')
        .update({ last_nudge_at: new Date().toISOString() })
        .eq('id', householdId)
    }

    return Response.json({ sent }, { headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 400, headers: corsHeaders })
  }
})
