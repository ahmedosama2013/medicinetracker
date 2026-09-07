/* The code-gated HTTP client: everything js/supporter.js needs, and nothing
 * else.
 *
 * js/supabase.js builds the full Supabase client -- auth, realtime, storage,
 * postgrest, functions -- because the elder's device genuinely uses all five.
 * A supporter device uses two. It has no session (every call carries the
 * household's share code instead), it cannot use Realtime (that respects RLS
 * and a supporter matches no rows), and it never touches storage directly
 * (photos come through the supporter-photo edge function as signed URLs).
 *
 * Importing the whole client to make an RPC call therefore cost a supporter
 * about 71KB across seven files, of which roughly 64KB was code that could
 * never run on that device. This is the same two pieces on their own, ~7KB:
 *
 *     postgrest-js   .rpc()               -- every call in js/supporter.js
 *     functions-js   .functions.invoke()  -- nudge and supporter-photo
 *
 * `?bundle` for the same reason js/supabase.js uses it: esm.sh otherwise
 * serves each package as its own little dependency graph to walk. Keep these
 * URLs in step with that file's.
 *
 * The client is stateless with respect to WHICH elder it is talking to -- the
 * share code is an argument to every call in js/supporter.js, never baked in
 * here. A device that supports two households would use one of these for both.
 */

import { PostgrestClient } from 'https://esm.sh/@supabase/postgrest-js@2?bundle';
import { FunctionsClient } from 'https://esm.sh/@supabase/functions-js@2?bundle';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

/* What createClient() sends when there is no session: the anon key as both the
 * apikey header and the bearer token. The code-gated functions are `security
 * definer` and do their own authorisation from the share code, so this is the
 * whole of the client's credentials -- see supabase/migrations/0001_init.sql. */
const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

let rest = null;
let fns = null;

/** Memoized like supabase() and db.open(). */
export function restClient() {
  if (!rest) rest = new PostgrestClient(`${SUPABASE_URL}/rest/v1`, { headers });
  return rest;
}

export function functionsClient() {
  if (!fns) fns = new FunctionsClient(`${SUPABASE_URL}/functions/v1`, { headers });
  return fns;
}
