// npm test: the seed has every product the website's choices point at, and a payment calls the right function.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { WEBSITE_CHOICE_CODES, recordPaid } from './dashboard.js'

const seeded = new Set([...readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8').matchAll(/\('([A-Z]{2}\d{2})',/g)].map((m) => m[1]))
assert.deepEqual(WEBSITE_CHOICE_CODES.filter((c) => !seeded.has(c)), []); console.log('  ✓ every product the website menu depends on is seeded')

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
