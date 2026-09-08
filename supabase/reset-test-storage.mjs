// Delete test files from the two private Storage buckets.
 // Run with SUPABASE_URL and SUPABASE_SECRET_KEY set.
 // WARNING: this is destructive and cannot be undone.

const base = process.env.SUPABASE_URL?.replace(/\/$/, '')
const key = process.env.SUPABASE_SECRET_KEY
if (!base || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY first.')

const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }
async function api(path, options = {}) {
  const response = await fetch(base + '/storage/v1' + path, { ...options, headers: { ...headers, ...(options.headers || {}) } })
  if (!response.ok) throw new Error((options.method || 'GET') + ' ' + path + ': ' + response.status + ' ' + await response.text())
  return response.status === 204 ? null : response.json()
}

async function existingBuckets() {
  const rows = await api('/bucket')
  return new Set((rows || []).map(row => row.id))
}

async function filesUnder(bucket, prefix = '') {
  const rows = await api('/object/list/' + bucket, { method: 'POST', body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }) })
  const files = []
  for (const row of rows || []) {
    const path = prefix + row.name
    if (row.id) files.push(path)
    else files.push(...await filesUnder(bucket, path + '/'))
  }
  return files
}

const buckets = await existingBuckets()
for (const bucket of ['med-photos', 'community-med-photos']) {
  if (!buckets.has(bucket)) {
    console.log(bucket + ': not found, skipped')
    continue
  }
  const files = await filesUnder(bucket)
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100)
    await api('/object/remove/' + bucket, { method: 'POST', body: JSON.stringify({ prefixes: batch }) })
  }
  console.log(bucket + ': deleted ' + files.length + ' file(s)')
}