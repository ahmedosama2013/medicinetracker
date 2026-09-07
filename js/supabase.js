/* Supabase client, memoized like db.open(). Loaded from a CDN ESM build so
 * the project keeps its no-build-step, no-node_modules constraint.
 *
 * `?bundle` matters more than it looks. Without it esm.sh serves the client as
 * its natural module graph -- a 531-byte stub naming five packages, which name
 * tslib, phoenix and a set of Node shims in turn: seventeen files over four
 * dependent round trips, measured at ~440ms on a fast desktop connection and a
 * great deal worse on a phone. `?bundle` inlines that graph, leaving four files
 * and two hops for the same bytes.
 *
 * Keep this URL and the modulepreload in index.html character-for-character
 * identical. They are different cache keys, so a mismatch quietly downloads
 * the client twice instead of once. */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?bundle';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;

export function supabase() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
