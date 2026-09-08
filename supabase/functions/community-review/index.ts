import { createClient } from 'npm:@supabase/supabase-js@2'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)
const bucket = 'community-med-photos'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-review-token, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors })
}

async function signed(path: string | null, expiresIn = 3600) {
  if (!path) return null
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error) throw error
  return data.signedUrl
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const expected = Deno.env.get('COMMUNITY_REVIEW_TOKEN')
    const supplied = req.headers.get('x-review-token')
    if (!expected || !supplied || supplied !== expected) return response({ error: 'Not authorized' }, 401)

    const body = await req.json()
    if (body.action === 'list') {
      const { data, error } = await db.from('community_photo_suggestions')
        .select('*, submitted_by_name, submitted_by_household_id, community_medicine_references(name,strength,pill_photo_path,packet_photo_path)')
        .order('created_at', { ascending: false })
      if (error) throw error
      const rows = await Promise.all((data || []).map(async row => ({
        ...row,
        old_photo_url: await signed(row.kind === 'pill'
          ? row.community_medicine_references?.pill_photo_path
          : row.community_medicine_references?.packet_photo_path),
        new_photo_url: await signed(row.photo_path),
      })))
      return response({ suggestions: rows })
    }

    if (body.action === 'review') {
      if (!['approved', 'rejected'].includes(body.status)) return response({ error: 'Invalid review status' }, 400)
      const { data: suggestion, error: readError } = await db.from('community_photo_suggestions')
        .select('id, reference_id, kind, photo_path, status')
        .eq('id', body.id).single()
      if (readError) throw readError

      const { error: suggestionError } = await db.from('community_photo_suggestions')
        .update({ status: body.status, reviewed_at: new Date().toISOString() })
        .eq('id', suggestion.id)
      if (suggestionError) throw suggestionError

      if (body.status === 'approved') {
        const column = suggestion.kind === 'pill' ? 'pill_photo_path' : 'packet_photo_path'
        const { error } = await db.from('community_medicine_references')
          .update({ [column]: suggestion.photo_path })
          .eq('id', suggestion.reference_id)
        if (error) throw error
      }
      return response({ ok: true })
    }
    return response({ error: 'Unknown action' }, 400)
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Request failed' }, 400)
  }
})
