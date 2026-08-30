/* Public config, safe to commit: the anon key and VAPID public key are meant
 * to be exposed client-side. Row Level Security and the code-gated functions
 * protect data, not these values. Fill in with your own Supabase project's
 * values -- see .env.example for where each one comes from. */

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-SUPABASE-ANON-KEY';
export const VAPID_PUBLIC_KEY = 'YOUR-VAPID-PUBLIC-KEY';
