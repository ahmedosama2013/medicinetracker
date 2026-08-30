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
  try {
    const { action, code, medicineId, photoBase64 } = await req.json()
    if (!code || !medicineId) return new Response('missing code or medicineId', { status: 400 })
    const householdId = await householdIdForCode(code)

    if (action === 'upload') {
      const bytes = Uint8Array.from(atob(photoBase64), (c) => c.charCodeAt(0))
      if (bytes.length > 512_000) return new Response('photo too large', { status: 400 })
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
      return Response.json({ path })
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
      return Response.json({ ok: true })
    }

    if (action === 'getUrl') {
      const { data: row } = await supabase
        .from('medicines')
        .select('photo_path')
        .eq('id', medicineId)
        .eq('household_id', householdId)
        .single()
      if (!row?.photo_path) return Response.json({ url: null })

      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.photo_path, 300)
      if (error) throw error
      return Response.json({ url: data.signedUrl })
    }

    return new Response('unknown action', { status: 400 })
  } catch (err) {
    return new Response(err.message ?? 'error', { status: 400 })
  }
})
