/* Public config, safe to commit: the anon key and VAPID public key are meant
 * to be exposed client-side. Row Level Security and the code-gated functions
 * protect data, not these values. Fill in with your own Supabase project's
 * values -- see .env.example for where each one comes from. */

export const SUPABASE_URL = 'https://dskldijulbxdzagrcmeo.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_1VgKgaoTVARa6-1y6jmpRA_wKMIGTCK';
export const VAPID_PUBLIC_KEY = 'BP5eRNvWPHRGtk_FW5865HNi8_ilralRR3HUzjCHRbpAFDbrHqFtozZeZvxS7R7EWONJTDf4xd9EU718QAQ9P7I';
