// node server/push.test.mjs: our WebCrypto Web Push against independent implementations
// (http_ece decrypts the payload like a browser would; Node's crypto checks the VAPID signature),
// plus who /api/notify sends to.
import assert from 'node:assert/strict'
import { createECDH, createPublicKey, verify } from 'node:crypto'
import ece from 'http_ece'
import { b64u, encrypt, makeVapidKeys, vapidAuth } from './push.js'
import { handleNotify } from './notify.js'

// A pretend browser subscription.
const ua = createECDH('prime256v1')
ua.generateKeys()
const authSecret = crypto.getRandomValues(new Uint8Array(16))
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: b64u.enc(ua.getPublicKey()), auth: b64u.enc(authSecret) }

const body = await encrypt(JSON.stringify({ title: 'Hi ✓', body: 'Pho is back' }), sub)
const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: Buffer.from(authSecret) })
assert.deepEqual(JSON.parse(plain.toString('utf8')), { title: 'Hi ✓', body: 'Pho is back' })
console.log('  ✓ payload decrypts with http_ece (aes128gcm, RFC 8291)')

const vapid = { ...(await makeVapidKeys()), subject: 'mailto:team@example.com' }
assert.equal(b64u.dec(vapid.publicKey).length, 65)
const header = await vapidAuth(sub.endpoint, vapid)
const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)
assert.equal(k, vapid.publicKey)
const [h, p, s] = jwt.split('.')
const claims = JSON.parse(Buffer.from(p, 'base64url'))
assert.equal(claims.aud, 'https://fcm.googleapis.com')
assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600)
const pub = b64u.dec(vapid.publicKey)
const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33)) }, format: 'jwk' })
assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')))
console.log('  ✓ VAPID token verifies with Node crypto (ES256), audience is the push service')

// ---- who gets what ----
const subs = [
  { id: 1, user_id: 'adm', profiles: { role: 'admin' }, ...sub },
  { id: 2, user_id: 'mgr', profiles: { role: 'manager' }, ...sub },
  { id: 3, user_id: 'stf', profiles: { role: 'staff' }, ...sub, endpoint: 'https://web.push.apple.com/gone' },
  { id: 4, user_id: 'old', profiles: { role: 'inactive' }, ...sub },
]
const fake = (role, extra = {}) => {
  const deleted = []
  return {
    deleted,
    auth: { getUser: async (t) => (t === 'tok' ? { data: { user: { id: extra.uid ?? 'adm' } } } : { error: {} }) },
    from: (table) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === 'profiles' ? { role } : table === 'rooms' ? { name: 'Garden Room' } : extra[table] }) }),
        then: (r) => r({ data: subs }),
      }),
      delete: () => ({ in: async (_, ids) => deleted.push(...ids) }),
    }),
  }
}
const sent = []
const fetchFn = async (url) => (sent.push(url), { status: url.includes('gone') ? 410 : 201 })
const run = async (admin, opts) => (sent.length = 0, handleNotify(admin, opts, vapid, fetchFn))

let r = await run(fake('admin', { announcements: { id: 'a1', title: 'New menu', body: 'Pho', audience: 'all' } }), { token: 'tok', body: { kind: 'announcement', id: 'a1' } })
assert.equal(r.status, 200); assert.equal(r.json.devices, 2) // manager + staff; not the admin who posted, not inactive
const adm = fake('admin', { announcements: { id: 'a1', title: 'x', body: '', audience: 'all' } })
await run(adm, { token: 'tok', body: { kind: 'announcement', id: 'a1' } })
assert.deepEqual(adm.deleted, [3]); console.log('  ✓ update reaches the team (not the sender, not inactive); a 410 device is forgotten')
r = await run(fake('admin', { announcements: { id: 'a2', title: 'Payroll', body: '', audience: 'managers' } }), { token: 'tok', body: { kind: 'announcement', id: 'a2' } })
assert.equal(r.json.devices, 1); console.log('  ✓ managers-only update skips staff')
r = await run(fake('manager', { uid: 'mgr' }), { token: 'tok', body: { kind: 'announcement', id: 'a1' } })
assert.equal(r.status, 403); console.log('  ✓ managers cannot send updates')
r = await run(fake('staff', { uid: 'stf', bookings: { id: 9, name: 'Ana', room_id: 'room-a', check_in: '2030-01-01', check_out: '2030-01-02', source: 'phone' } }), { token: 'tok', body: { kind: 'booking', id: 9 } })
assert.equal(r.json.devices, 2); console.log('  ✓ a booking alerts admins and managers')
r = await run(fake('staff', { uid: 'stf' }), { token: 'tok', body: { kind: 'test' } })
assert.equal(r.json.devices, 1); assert.deepEqual(sent, ['https://web.push.apple.com/gone']); console.log('  ✓ a test goes only to your own devices')
r = await run(fake('admin'), { webhookSecret: 'nope', expectedSecret: 'right', body: {} })
assert.equal(r.status, 401)
r = await run(fake('admin'), { webhookSecret: 'right', expectedSecret: 'right', body: { type: 'INSERT', table: 'bookings', record: { id: 5, name: 'Web Guest', room_id: 'room-b', check_in: '2030-02-01', check_out: '2030-02-03', source: 'web' } } })
assert.equal(r.json.devices, 2); console.log('  ✓ website bookings via the Supabase webhook need the secret, then alert managers')
r = await handleNotify(fake('admin'), { token: 'tok', body: { kind: 'test' } }, {}, fetchFn)
assert.equal(r.status, 500); console.log('  ✓ missing VAPID keys explain themselves')
console.log('push: all checks passed')
