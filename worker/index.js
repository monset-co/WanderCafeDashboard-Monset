// Cloudflare Worker: serves the built app from dist/ (wrangler.jsonc › assets) and runs the one
// server route, POST /api/staff. The rules live in server/staff.js.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as Worker secrets (server only: never VITE_).
import { createClient } from '@supabase/supabase-js'
import { handleStaff } from '../server/staff.js'

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname !== '/api/staff') return env.ASSETS.fetch(request)
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 })

    const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
    const key = env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return Response.json({ error: 'Adding staff needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set as Worker secrets.' }, { status: 500 })

    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const token = String(request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    try {
      const body = await request.json().catch(() => ({}))
      const { status, json } = await handleStaff(admin, token, body)
      return Response.json(json, { status })
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 })
    }
  },
}
