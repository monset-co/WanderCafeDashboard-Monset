// node server/staff.test.mjs: the account rules, against a fake Supabase admin client.
import assert from 'node:assert/strict'
import { handleStaff } from './staff.js'

const fake = ({ role = 'admin', exists = false } = {}) => {
  const calls = []
  return {
    calls,
    auth: {
      getUser: async (t) => (t === 'good' ? { data: { user: { id: 'me' } } } : { error: { message: 'bad jwt' } }),
      admin: {
        createUser: async (u) => (calls.push(['create', u]), exists ? { error: { message: 'User already registered' } } : { data: { user: { id: 'new' } } }),
        updateUserById: async (id, u) => (calls.push(['password', id, u]), {}),
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role } }) }) }),
      update: (v) => ({ eq: async (_, id) => (calls.push(['role', id, v]), {}) }),
    }),
  }
}
const good = { action: 'create', email: ' Kim@Wander.ph ', full_name: 'Kim', role: 'manager', password: 'longenough' }

assert.equal((await handleStaff(fake(), '', good)).status, 401)
assert.equal((await handleStaff(fake(), 'bad', good)).status, 401)
assert.equal((await handleStaff(fake({ role: 'manager' }), 'good', good)).status, 403)
assert.equal((await handleStaff(fake(), 'good', { ...good, password: 'short' })).status, 400)
assert.equal((await handleStaff(fake(), 'good', { ...good, role: 'owner' })).status, 400)
assert.equal((await handleStaff(fake({ exists: true }), 'good', good)).status, 409)
const f = fake()
const r = await handleStaff(f, 'good', good)
assert.equal(r.status, 200)
assert.equal(f.calls[0][1].email, 'kim@wander.ph')
assert.deepEqual(f.calls[1], ['role', 'new', { full_name: 'Kim', role: 'manager' }])
assert.equal((await handleStaff(fake(), 'good', { action: 'password', user_id: 'x', password: 'longenough' })).status, 400)
console.log('staff API: all checks passed')
