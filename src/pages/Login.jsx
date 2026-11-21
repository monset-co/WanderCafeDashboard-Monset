import { useState } from 'react'
import { motion } from 'motion/react'
import { LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../auth.jsx'
import { BTN, EASE_OUT, FIELD, LABEL, Problem, Submit } from '../components/ui.jsx'

function Frame({ children }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <motion.div className="w-full max-w-sm" initial={{ opacity: 0, transform: 'translateY(12px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.45, ease: EASE_OUT }}>
        <img src="/favicon.svg" alt="" className="mx-auto size-16" />
        <p className="mt-4 text-center font-display text-5xl font-semibold tracking-[-0.03em]">Wander</p>
        <p className="mt-1 text-center text-xs font-bold tracking-[0.16em] text-bean uppercase">Cafe + B&amp;B · team dashboard</p>
        {children}
      </motion.div>
    </main>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : /fetch|network/i.test(error.message) ? 'No connection. Check the wifi and try again.' : error.message)
    setBusy(false)
  }

  return (
    <Frame>
      <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl bg-paper p-6 ring-1 ring-parchment shadow-[0_12px_40px_-20px_rgb(74_52_40/0.35)]">
        <h1 className="text-lg font-bold">Sign in</h1>
        <label className={LABEL}>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${FIELD} mt-1.5`} />
        </label>
        <label className={LABEL}>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={`${FIELD} mt-1.5`} />
        </label>
        {error && <Problem>{error}</Problem>}
        <Submit busy={busy}>{busy ? 'Signing in' : 'Sign in'}</Submit>
      </form>
      <p className="mt-5 text-center text-sm text-bean">No account? Ask the admin to add you on the Staff page.</p>
    </Frame>
  )
}

// Signed in, but the role is inactive (new account, or switched off).
export function NoAccess() {
  const { session, profile, signOut } = useAuth()
  return (
    <Frame>
      <div className="mt-8 rounded-2xl bg-paper p-6 text-center ring-1 ring-parchment">
        <h1 className="text-lg font-bold">{profile?.error ? 'Couldn’t check your access' : 'Not active yet'}</h1>
        <p className="mt-2 text-bean">
          {profile?.error ? (
            <>The database refused to read your account: <b className="text-espresso">{profile.error}</b>. Run the latest supabase/schema.sql in the Supabase SQL Editor, then refresh.</>
          ) : (
            <><b className="text-espresso">{session.user.email}</b> is signed in but has no access. Ask the admin to set your role on the Staff page.</>
          )}
        </p>
        <button type="button" onClick={signOut} className={`${BTN.quiet} mt-5`}>
          <LogOut className="size-4" aria-hidden="true" /> Sign out
        </button>
      </div>
    </Frame>
  )
}

export function Setup() {
  return (
    <Frame>
      <div className="mt-8 rounded-2xl bg-paper p-6 ring-1 ring-parchment">
        <h1 className="text-lg font-bold">Connect Supabase</h1>
        <p className="mt-2 text-bean">
          Copy <code className="font-semibold text-teal-deep">.env.example</code> to <code className="font-semibold text-teal-deep">.env.local</code> and fill in the project URL and anon key from Supabase › Project Settings › API. On Cloudflare Pages, add the same two values as environment variables and redeploy.
        </p>
      </div>
    </Frame>
  )
}

// Session and role check. Shown briefly; no spinner theatre.
export function Booting() {
  return (
    <main className="grid min-h-dvh place-items-center" role="status" aria-label="Loading">
      <img src="/favicon.svg" alt="" className="size-12 animate-pulse" />
    </main>
  )
}
