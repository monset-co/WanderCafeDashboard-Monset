// Website ↔ dashboard contract (README.md beside this file). The website (WanderCafe-monset) is live on this
// project and keeps its own copy of this call in api/paymongo-webhook.js; this file is the reference
// and what npm test checks. The database does the work (supabase/schema.sql section 12).

// Codes the website's choices map to directly (menu.js `code` / `extra` on a choice), so they must exist in
// Inventory: each ulam, the Crispy Pata group meal, the paid add-ons. Plain items map one code each and are
// simply hidden online if missing; these would make a whole item or option vanish.
export const WEBSITE_CHOICE_CODES = ['FP01', 'FP02', 'FP03', 'FP04', 'FP05', 'FP06', 'FP07', 'NW02', 'NW03', 'AD01', 'AD02']

// On PayMongo's signed "paid" webhook. `db` is the website's PostgREST helper (api/_db.js).
// Returns its { ok, status, data }; not ok -> the website answers 500 so PayMongo retries.
export function recordPaid(db, kind, ref, session) {
  const pay = session.payments?.[0]
  const p_payment_id = pay?.id ?? null
  return kind === 'order'
    ? db('rpc/record_web_order', { method: 'POST', body: { p_ref: ref, p_payment_id, p_method: pay?.attributes?.source?.type ?? null } })
    : db('rpc/confirm_web_booking', { method: 'POST', body: { p_ref: ref, p_payment_id } })
}
