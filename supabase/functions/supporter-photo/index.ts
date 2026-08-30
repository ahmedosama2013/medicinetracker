// Photo upload/delete/read for a supporter device, which has no Supabase
// session -- the share code is the only credential, validated the same way
// as the code-gated Postgres functions (app.household_by_code). Binary
// handling and signed URLs don't fit cleanly in a SQL function, hence a
// dedicated Edge Function using the service_role client for Storage.
import { createClient } from 'npm:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const BUCKET = 'med-photos'

// Called directly from browser JS (no proxy), so the browser sends a CORS
// preflight OPTIONS request before the real one -- without these headers on
// every response, that preflight fails and the real request never goes out.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Queries the table directly (service_role bypasses RLS) rather than calling
// app.household_by_code via RPC, since PostgREST only exposes the `public`
// schema and app.* functions aren't reachable that way.
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
    const { action, code, medicineId, photoBase64 } = await req.json()
    if (!code || !medicineId) {
      return new Response('missing code or medicineId', { status: 400, headers: corsHeaders })
    }
    const householdId = await householdIdForCode(code)

    if (action === 'upload') {
      const bytes = Uint8Array.from(atob(photoBase64), (c) => c.charCodeAt(0))
      if (bytes.length > 512_000) {
        return new Response('photo too large', { status: 400, headers: corsHeaders })
      }
      const path = `${householdId}/${medicineId}/${crypto.randomUUID()}.jpg`
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: 'image/jpeg' })
      if (uploadError) throw uploadError

      const { data: existing } = await supabase
        .from('medicines')
        .select('photo_path')
        .eq('id', medicineId)
        .eq('household_id', householdId)
        .single()

      await supabase
        .from('medicines')
        .update({ photo_path: path })
        .eq('id', medicineId)
        .eq('household_id', householdId)

      if (existing?.photo_path) await supabase.storage.from(BUCKET).remove([existing.photo_path])
      return Response.json({ path }, { headers: corsHeaders })
    }

    if (action === 'delete') {
      const { data: existing } = await supabase
        .from('medicines')
        .select('photo_path')
        .eq('id', medicineId)
        .eq('household_id', householdId)
        .single()

      await supabase
        .from('medicines')
        .update({ photo_path: null })
        .eq('id', medicineId)
        .eq('household_id', householdId)

      if (existing?.photo_path) await supabase.storage.from(BUCKET).remove([existing.photo_path])
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    if (action === 'getUrl') {
      const { data: row } = await supabase
        .from('medicines')
        .select('photo_path')
        .eq('id', medicineId)
        .eq('household_id', householdId)
        .single()
      if (!row?.photo_path) return Response.json({ url: null }, { headers: corsHeaders })

      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.photo_path, 300)
      if (error) throw error
      return Response.json({ url: data.signedUrl }, { headers: corsHeaders })
    }

    return new Response('unknown action', { status: 400, headers: corsHeaders })
  } catch (err) {
    return new Response(err.message ?? 'error', { status: 400, headers: corsHeaders })
  }
})
