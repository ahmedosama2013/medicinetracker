/* Simple-only: Google sign-in and the household this account owns.
 * A supporter never touches this module -- see supporter.js instead. */

import { supabase } from './supabase.js';

export async function getSession() {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

export function onAuthStateChange(cb) {
  const { data } = supabase().auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle() {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase().auth.signOut();
}

/** The household this signed-in account owns, or null if none exists yet. */
export async function getMyHousehold() {
  const { data, error } = await supabase().from('households').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export async function createHousehold(displayName, timezone) {
  const { data, error } = await supabase().rpc('create_household', {
    p_display_name: displayName,
    p_timezone: timezone,
  });
  if (error) throw error;
  return data;
}

export async function rotateShareCode() {
  const { data, error } = await supabase().rpc('rotate_share_code');
  if (error) throw error;
  return data;
}
