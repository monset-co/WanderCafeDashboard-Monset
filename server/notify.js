// POST /api/notify: who gets a push, and what it says. `admin` is a service-role Supabase client.
//   { kind: 'test' }                     the caller's own devices (any staff)
//   { kind: 'announcement', id }         an admin's update, to everyone it's for
//   { kind: 'booking', id }              a booking made in the dashboard, to managers and admins
// Supabase Database Webhooks (header x-webhook-secret = WEBHOOK_SECRET), on UPDATE, bring the website in:
//   bookings: a website booking turning 'confirmed' (paid)    -> managers and admins
//   orders:   a website order getting its sale (on the board) -> everyone on the team
// Inserts are ignored: a website insert is an unpaid hold, and the dashboard alerts its own bookings.
import { sendPush } from './push.js'

const fail = (status, error) => ({ status, json: { error } })
const MANAGERS = ['admin', 'manager']
const ALL = ['admin', 'manager', 'staff']
const day = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' })

async function bookingMessage(admin, b) {
  const { data: room } = await admin.from('rooms').select('name').eq('id', b.room_id).maybeSingle()
  return { title: `New booking · ${b.name}`, body: `${room?.name ?? b.room_id}, ${day(b.check_in)} – ${day(b.check_out)}${b.source === 'web' ? ' · from the website' : ''}`, url: '/bookings', tag: `booking-${b.id}` }
}

const orderMessage = (o) => {
  const items = (o.items ?? []).reduce((n, i) => n + (Number(i.qty) || 0), 0)
  return { title: `Website order · ${o.name}`, body: `${items} item${items === 1 ? '' : 's'}, ${o.mode === 'dine-in' ? 'dine-in' : 'pick-up'} ${day(o.ready_date)} ${o.ready_time}`, url: '/orders', tag: `order-${o.ref}` }
}

export async function handleNotify(admin, { token, webhookSecret, expectedSecret, body = {} }, vapid, fetchFn) {
  if (!vapid?.publicKey || !vapid?.privateKey) return fail(500, 'Notifications need VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY set in Cloudflare.')
  let roles, message, only = null, skip = null

  if (webhookSecret) {
    if (!expectedSecret || webhookSecret !== expectedSecret) return fail(401, 'Bad webhook secret.')
    const { type, table, record: rec, old_record: old } = body
    if (type === 'UPDATE' && table === 'bookings' && rec?.source === 'web' && rec.status === 'confirmed' && old?.status !== 'confirmed')
      [roles, message] = [MANAGERS, await bookingMessage(admin, rec)]
    else if (type === 'UPDATE' && table === 'orders' && rec?.sale_id && !old?.sale_id)
      [roles, message] = [ALL, orderMessage(rec)]
    else return { status: 200, json: { sent: 0 } }
  } else {
    if (!token) return fail(401, 'Sign in again.')
    const { data: auth, error } = await admin.auth.getUser(token)
    if (error || !auth?.user) return fail(401, 'Sign in again.')
    const { data: me } = await admin.from('profiles').select('role').eq('id', auth.user.id).maybeSingle()
    if (!ALL.includes(me?.role)) return fail(403, 'No access.')

    if (body.kind === 'test') {
      ;[roles, only, message] = [ALL, auth.user.id, { title: 'Wander notifications are on', body: 'This device will get updates, new bookings and alerts.', url: '/updates', tag: 'test' }]
    } else if (body.kind === 'announcement') {
      if (me.role !== 'admin') return fail(403, 'Only an admin can send updates.')
      const { data: a } = await admin.from('announcements').select('id, title, body, audience').eq('id', body.id).maybeSingle()
      if (!a) return fail(404, 'That update was not found.')
      ;[roles, skip, message] = [a.audience === 'managers' ? MANAGERS : ALL, auth.user.id, { title: a.title, body: a.body.slice(0, 180) || 'New update from the admin', url: '/updates', tag: `update-${a.id}` }]
    } else if (body.kind === 'booking') {
      const { data: b } = await admin.from('bookings').select('*').eq('id', body.id).maybeSingle()
      if (!b) return fail(404, 'That booking was not found.')
      ;[roles, skip, message] = [MANAGERS, auth.user.id, await bookingMessage(admin, b)]
    } else return fail(400, 'Unknown notification.')
  }

  const { data: subs, error } = await admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth, profiles(role)')
  if (error) return fail(500, error.message)
  const targets = subs.filter((s) => roles.includes(s.profiles?.role) && (!only || s.user_id === only) && s.user_id !== skip)
  const results = await Promise.all(targets.map((s) => sendPush(s, message, vapid, fetchFn).catch(() => 0)))
  const gone = targets.filter((_, i) => results[i] === 404 || results[i] === 410).map((s) => s.id)
  if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone)
  const sent = results.filter((r) => r >= 200 && r < 300).length
  if (body.kind === 'test' && !targets.length) return fail(400, 'This account has no devices with notifications on yet.')
  return { status: 200, json: { sent, devices: targets.length } }
}
