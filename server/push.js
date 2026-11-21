// Web Push on WebCrypto alone, so it runs in a Cloudflare Worker (and in Node for tests):
// VAPID (RFC 8292) signs who's sending; the payload is encrypted for the device (RFC 8291, aes128gcm).
// Keys are base64url: VAPID_PUBLIC_KEY is the 65-byte public point, VAPID_PRIVATE_KEY the 32-byte secret.

const enc = new TextEncoder()
export const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)),
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) out.set(p, i), (i += p.length)
  return out
}
const hkdf = async (salt, ikm, info, bytes) =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8))

// A signed token saying this server may push to that push service, for 12 hours.
export async function vapidAuth(endpoint, { publicKey, privateKey, subject }) {
  const pub = b64u.dec(publicKey)
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const part = (o) => b64u.enc(enc.encode(JSON.stringify(o)))
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)) // raw r||s, as ES256 wants
  return `vapid t=${unsigned}.${b64u.enc(sig)}, k=${publicKey}`
}

// Encrypts `payload` (a string) for one subscription: { p256dh, auth } from the browser.
export async function encrypt(payload, { p256dh, auth }) {
  const uaPublic = b64u.dec(p256dh)
  const authSecret = b64u.dec(auth)
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256))

  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plain = concat(enc.encode(payload), new Uint8Array([2])) // 0x02: the last (only) record
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain))
  const header = new Uint8Array(21)
  header.set(salt)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  return concat(header, asPublic, sealed)
}

// Sends one notification. Resolves to the push service's HTTP status (201 = delivered;
// 404/410 = that device unsubscribed, so the caller should forget it).
export async function sendPush(sub, message, vapid, fetchFn = fetch) {
  const body = await encrypt(JSON.stringify(message), sub)
  const res = await fetchFn(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuth(sub.endpoint, vapid),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '86400',
      urgency: 'high',
    },
    body,
  })
  return res.status
}

// New VAPID keys (npm run vapid).
export async function makeVapidKeys() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey)
  return { publicKey: b64u.enc(await crypto.subtle.exportKey('raw', k.publicKey)), privateKey: jwk.d }
}
