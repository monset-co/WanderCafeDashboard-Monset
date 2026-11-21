// Cloudflare Worker: serves the built app from dist/ (wrangler.jsonc › assets) and runs the server routes:
//   POST /api/staff   create logins, reset passwords (server/staff.js)
//   POST /api/notify  push notifications (server/notify.js)
// Secrets (Settings › Variables and Secrets; never VITE_): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET.
import { createClient } from '@supabase/supabase-js'
import { handleStaff } from '../server/staff.js'
import { handleNotify } from '../server/notify.js'

const ROUTES = { '/api/staff': true, '/api/notify': true }

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (!ROUTES[pathname]) return env.ASSETS.fetch(request)
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 })

    const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
    const key = env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return Response.json({ error: 'The server needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set as Worker secrets.' }, { status: 500 })

    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const token = String(request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    try {
      const body = await request.json().catch(() => ({}))
      const { status, json } =
        pathname === '/api/staff'
          ? await handleStaff(admin, token, body)
          : await handleNotify(
              admin,
              { token, body, webhookSecret: request.headers.get('x-webhook-secret'), expectedSecret: env.WEBHOOK_SECRET },
              { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:wandercafemoalboal@gmail.com' },
            )
      return Response.json(json, { status })
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 })
    }
  },
}
