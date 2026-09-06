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
//
// DEPLOY WITH --no-verify-jwt. With verification on, Supabase's gateway
// rejects the browser's CORS preflight (which never carries an Authorization
// header) before this file runs, and the browser reports a bare "Failed to
// fetch" that is indistinguishable from the function not existing -- while the
// CLI still lists it as ACTIVE. See docs/setup.md.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

/* VAPID is configured on first use, not at module load.
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/* One nudge per household per this many minutes, whatever the UI does.
 *
 * Fifteen, not sixty. The thing worth preventing is a burst -- someone worried
 * pressing the button four times in a minute, producing four buzzes on an
 * elderly person's phone. An hour also blocked the legitimate case: nudge, no
 * response, reasonably want to try once more twenty minutes later. Fifteen
 * minutes absorbs the burst and permits the follow-up. */
const COOLDOWN_MINUTES = 15

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
    const { data: household, error: householdErr } = await supabase
      .from('households')
      .select('last_nudge_at')
      .eq('id', householdId)
      .single()
    if (householdErr) {
      return Response.json({ sent: 0, reason: 'db-error', detail: householdErr.message },
        { status: 500, headers: corsHeaders })
    }

    const last = household?.last_nudge_at ? Date.parse(household.last_nudge_at) : 0
    const waitMs = COOLDOWN_MINUTES * 60_000 - (Date.now() - last)
    if (waitMs > 0) {
      return Response.json(
        { sent: 0, retryInMinutes: Math.ceil(waitMs / 60_000) },
        { status: 429, headers: corsHeaders },
      )
    }

    const vapidError = ensureVapid()
    if (vapidError) {
      return Response.json({ sent: 0, reason: 'push-not-configured', detail: vapidError },
        { status: 500, headers: corsHeaders })
    }

    /* The error is checked, not discarded. Without a grant this query fails
     * with "permission denied" rather than returning nothing, and swallowing
     * that reported a household with two live subscriptions as having none --
     * which is indistinguishable from reminders simply being off. See 0008. */
    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .eq('household_id', householdId)
      .eq('notify_due', true)
      .is('disabled_at', null)

    if (subsErr) {
      return Response.json({ sent: 0, reason: 'db-error', detail: subsErr.message },
        { status: 500, headers: corsHeaders })
    }

    if (!subs?.length) {
      // Distinguished from a delivered nudge on purpose: the supporter needs
      // to know reminders were never turned on, or they will assume silence
      // means the message arrived and was ignored.
      return Response.json({ sent: 0, reason: 'no-subscriptions' }, { headers: corsHeaders })
    }

    let sent = 0
    const failures: string[] = []
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
        failures.push(String((err as { statusCode?: number; body?: string })?.body ?? (err as Error)?.message ?? err).slice(0, 120))
        // A direct update, not rpc('disable_push_subscription'): that function
        // lives in the `app` schema, which PostgREST does not expose, so the
        // call could never have resolved.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from('push_subscriptions')
            .update({ disabled_at: new Date().toISOString() })
            .eq('id', sub.id)
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

    // `sent: 0` with no reason would be a silent failure all over again.
    return Response.json(
      failures.length ? { sent, reason: 'send-failed', detail: failures } : { sent },
      { headers: corsHeaders },
    )
  } catch (err) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 400, headers: corsHeaders })
  }
})
