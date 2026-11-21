import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)
export const supabase = configured ? createClient(url, key) : null

// A function Supabase can't find means supabase/schema.sql hasn't been run on this project.
if (supabase) {
  const rpc = supabase.rpc.bind(supabase)
  supabase.rpc = (fn, args, opts) =>
    rpc(fn, args, opts).then((r) =>
      r.error && /could not find the function/i.test(r.error.message)
        ? { ...r, error: { ...r.error, message: 'The database is missing an update. In Supabase › SQL Editor, run supabase/schema.sql, then refresh.' } }
        : r,
    )
}

// POST to a Cloudflare Pages Function (functions/api/*.js) with the signed-in user's session.
export async function serverApi(path, body) {
  const { data } = await supabase.auth.getSession()
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok) return { data: j }
    return { error: j.error ?? (r.status === 404 ? 'This only works on the deployed site, not in npm run dev.' : `Server error (${r.status}).`) }
  } catch {
    return { error: 'Connection problem. Try again.' }
  }
}
