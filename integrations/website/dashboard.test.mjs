// npm test: the website bridge only points at products the dashboard seeds, and calls the right function.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EXTRA_CODE, POS_CODE, orderLine, recordPaid } from './dashboard.js'

const seeded = new Set([...readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8').matchAll(/\('([A-Z]{2}\d{2})',/g)].map((m) => m[1]))
const missing = [...Object.values(POS_CODE), ...Object.values(EXTRA_CODE)].filter((c) => !seeded.has(c))
assert.deepEqual(missing, []); console.log('  ✓ every website menu code is a seeded POS product')

assert.deepEqual(orderLine({ id: 'ramen', label: 'Ramen (Spicy, Add cheese slice)', unit: 140, qty: 2, picked: ['Spicy', 'Add cheese slice'] }),
  { code: 'CC03', label: 'Ramen (Spicy, Add cheese slice)', unit: 140, qty: 2, extras: ['AD02'] })
assert.equal(orderLine({ id: 'new-thing', label: 'New', unit: 1, qty: 1 }).code, null); console.log('  ✓ cart lines carry POS codes and paid extras')

const calls = []
const db = async (path, opts) => (calls.push([path, opts.body]), { ok: true })
const session = { payments: [{ id: 'pay_1', attributes: { source: { type: 'gcash' } } }] }
await recordPaid(db, 'order', 'WDO-1', session)
await recordPaid(db, 'booking', 'WDR-1', session)
assert.deepEqual(calls, [
  ['rpc/record_web_order', { p_ref: 'WDO-1', p_payment_id: 'pay_1', p_method: 'gcash' }],
  ['rpc/confirm_web_booking', { p_ref: 'WDR-1', p_payment_id: 'pay_1' }],
]); console.log('  ✓ a paid order records a sale; a paid booking is confirmed')
console.log('website bridge: all checks passed')
