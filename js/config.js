/* Public config, safe to commit: the anon key and VAPID public key are meant
 * to be exposed client-side. Row Level Security and the code-gated functions
 * protect data, not these values. Fill in with your own Supabase project's
 * values -- see .env.example for where each one comes from. */

export const SUPABASE_URL = 'https://bvrunnaoeotbijttrvkz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2cnVubmFvZW90YmlqdHRydmt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwODIwOTYsImV4cCI6MjEwMzY1ODA5Nn0.REQPX0vir_LgdBf76o5G7PsuGMiTgbPj6ANqvt2iVfo';
export const VAPID_PUBLIC_KEY = 'BPHTdfNjDEua2qDIfHFe2AFOvh-wAzx3eAZ9PF84kYPUr86y7AQyBfG2ochjAc3devXm8eMHmuVp-NU8P6zSAeY';
