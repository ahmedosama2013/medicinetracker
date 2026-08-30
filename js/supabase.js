/* Supabase client, memoized like db.open(). Loaded from a CDN ESM build so
 * the project keeps its no-build-step, no-node_modules constraint. */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;

export function supabase() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
