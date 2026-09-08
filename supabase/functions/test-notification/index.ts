// An elder verifies that reminders work on this exact device.
//
// This is deliberately not a generic push relay: the authenticated user must
// own the subscription endpoint, it must be a patient subscription, and the
// message contains no medicine or schedule information. Deploy with
// --no-verify-jwt so browser CORS preflight reaches this explicit auth check.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { testNotification } from '../_shared/messages.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

let vapidReady: boolean | string = false
function ensureVapid(): string | null {
  if (vapidReady === true) return null
  if (typeof vapidReady === 'string') return vapidReady
  const email = Deno.env.get('VAPID_CONTACT_EMAIL')
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  const missing = [!email && 'VAPID_CONTACT_EMAIL', !pub && 'VAPID_PUBLIC_KEY', !priv && 'VAPID_PRIVATE_KEY'].filter(Boolean)
  if (missing.length) return vapidReady = `missing secrets: ${missing.join(', ')}`
  try {
    webpush.setVapidDetails(`mailto:${email}`, pub!, priv!)
    vapidReady = true
    return null
  } catch (err) {
    return vapidReady = `VAPID keys rejected: ${String((err as Error)?.message ?? err)}`
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return Response.json({ error: 'Sign in before sending a test.' }, { status: 401, headers: corsHeaders })
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) return Response.json({ error: 'Sign in before sending a test.' }, { status: 401, headers: corsHeaders })

    const { endpoint } = await req.json()
    if (typeof endpoint !== 'string' || !endpoint) return Response.json({ error: 'No device subscription found.' }, { status: 400, headers: corsHeaders })

    const { data: sub, error: subError } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .eq('endpoint', endpoint)
      .eq('user_id', user.id)
      .eq('role', 'patient')
      .is('disabled_at', null)
      .maybeSingle()
    if (subError) throw subError
    if (!sub) return Response.json({ error: 'This device no longer has reminders turned on.' }, { status: 404, headers: corsHeaders })

    const vapidError = ensureVapid()
    if (vapidError) return Response.json({ error: 'Push notifications are not configured yet.' }, { status: 500, headers: corsHeaders })

    try {
      const { title, body } = testNotification()
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, JSON.stringify({ title, body }))
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').update({ disabled_at: new Date().toISOString() }).eq('id', sub.id)
      }
      return Response.json({ error: 'The test reminder could not be delivered.' }, { status: 502, headers: corsHeaders })
    }

    return Response.json({ sent: 1 }, { headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String((err as Error)?.message ?? err) }, { status: 400, headers: corsHeaders })
  }
})
