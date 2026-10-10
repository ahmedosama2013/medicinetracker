/* One row in app.push_log per device per send (see 0030_push_log.sql).
 *
 * Best effort by design: this never throws and never changes whether a
 * notification counts as sent. Losing a log row is a gap in a history;
 * letting a log failure retry or block a reminder would be a real bug. */

// deno-lint-ignore no-explicit-any
type Client = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: any }> }

export type PushKind = 'reminder' | 'follow-up' | 'escalation' | 'nightly' | 'nudge' | 'test'

export interface PushLogEntry {
  householdId: string
  subscriptionId: string | null
  role: string | null
  kind: PushKind
  title: string
  body: string
  ok: boolean
  statusCode?: number | null
  error?: string | null
  localDate?: string | null
  slotId?: string | null
}

export async function logPush(supabase: Client, e: PushLogEntry): Promise<void> {
  try {
    const { error } = await supabase.rpc('log_push', {
      p_household: e.householdId,
      p_subscription: e.subscriptionId,
      p_role: e.role,
      p_kind: e.kind,
      p_title: e.title,
      p_body: e.body,
      p_ok: e.ok,
      p_status_code: e.statusCode ?? null,
      p_error: e.error ?? null,
      p_local_date: e.localDate ?? null,
      p_slot: e.slotId ?? null,
    })
    if (error) console.error('push_log write failed:', error.message)
  } catch (err) {
    console.error('push_log write failed:', String((err as Error)?.message ?? err))
  }
}

/* The failure details worth keeping from a web-push error. */
export function pushError(err: unknown): { statusCode: number | null; error: string } {
  const e = err as { statusCode?: number; body?: string; message?: string }
  return {
    statusCode: e?.statusCode ?? null,
    error: String(e?.body || e?.message || err).slice(0, 300),
  }
}
