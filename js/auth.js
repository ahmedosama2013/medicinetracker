/* Simple-only: Google sign-in and the household this account owns.
 * A supporter never touches this module -- see supporter.js instead. */

import { supabase } from './supabase.js';
import { firstNameOf } from './strings.js';

export async function getSession() {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

/** The Google account's full name, or null if there is nothing usable. */
export function fullNameFromSession(session) {
  return session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || null;
}

/** The Google account's given name, or null if there is nothing usable. */
export function firstNameFromSession(session) {
  return firstNameOf(fullNameFromSession(session)) || null;
}

export function onAuthStateChange(cb) {
  const { data } = supabase().auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle() {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      /* Explicit rather than relying on the provider's default: without
       * `profile`, Google's ID token can come back with no name claim at all,
       * which is exactly what silently sent every household's displayName to
       * the email-prefix fallback further down this file. */
      scopes: 'profile email',
    },
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

/** Corrects a household's stored name once a fuller one becomes available --
 * a household created before this was captured, or a session that briefly had
 * no name claim. Owner-only, enforced by RLS the same as rotateShareCode. */
export async function updateHouseholdDisplayName(householdId, displayName) {
  const { error } = await supabase().from('households')
    .update({ display_name: displayName })
    .eq('id', householdId);
  if (error) throw error;
}

export async function createHousehold(displayName, timezone, usesOrganizer = true) {
  const { data, error } = await supabase().rpc('create_household', {
    p_display_name: displayName,
    p_timezone: timezone,
    p_uses_organizer: usesOrganizer,
  });
  if (error) throw error;
  return data;
}

export async function rotateShareCode() {
  const { data, error } = await supabase().rpc('rotate_share_code');
  if (error) throw error;
  return data;
}
