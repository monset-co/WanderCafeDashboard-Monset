import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { KeyRound, Plus, UserRound } from 'lucide-react'
import { supabase, serverApi } from '../lib/supabase.js'
import { fmtDateTime } from '../lib/util.js'
import { BTN, Badge, CARD, Empty, FIELD, LABEL, PageHeader, Problem, Sheet, SkeletonRows, Submit, useToast } from '../components/ui.jsx'
import { ROLE_LABEL, useAuth } from '../auth.jsx'

const ROLES = [
  ['staff', 'Staff', 'Register, own receipts, stock in and out, bookings day to day.'],
  ['manager', 'Manager', 'Plus every receipt and voids, analytics, menu and prices, rooms, any booking change.'],
  ['admin', 'Admin', 'Plus adding logins and changing who can do what.'],
  ['inactive', 'No access', 'Can’t sign in to anything. Their history stays.'],
]
const TONE = { admin: 'info', manager: 'ok', staff: 'muted', inactive: 'bad' }

export default function Staff() {
  const { session } = useAuth()
  const notify = useToast()
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null) // person, or 'new'

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('staff_list')
    if (error) return setError(error.message)
    setError(null)
    setList(data)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const current = open && open !== 'new' ? list?.find((p) => p.id === open.id) : null

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader title="Staff" sub="Who can sign in, and what each person can do.">
        <button type="button" onClick={() => setOpen('new')} className={BTN.primary}>
          <Plus className="size-4" aria-hidden="true" /> Add a login
        </button>
      </PageHeader>

      {error && <div className="mt-6"><Problem onRetry={load}>{error}</Problem></div>}
      <div className={`${CARD} mt-6 overflow-hidden`}>
        {!list && !error && <SkeletonRows rows={4} label="Loading staff" />}
        {list?.length === 0 && <Empty>No one yet.</Empty>}
        {list && list.length > 0 && (
          <ul className="divide-y divide-parchment/60">
            {list.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setOpen(p)} className="group flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-cream">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-parchment/70 text-bean"><UserRound className="size-5" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold group-hover:underline group-hover:decoration-teal group-hover:underline-offset-4">
                      {p.full_name || p.email} {p.id === session.user.id && <span className="text-sm font-semibold text-bean">(you)</span>}
                    </span>
                    <span className="block truncate text-sm text-bean">{p.email} · {p.last_sign_in_at ? `last in ${fmtDateTime(p.last_sign_in_at)}` : 'never signed in'}</span>
                  </span>
                  <Badge tone={TONE[p.role]}>{ROLE_LABEL[p.role]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AnimatePresence>
        {open === 'new' && <NewLogin key="new" onClose={() => setOpen(null)} onDone={(name) => (setOpen(null), load(), notify(`${name} can sign in now`))} />}
        {current && <Person key="person" p={current} me={current.id === session.user.id} onClose={() => setOpen(null)} onDone={(msg) => (load(), notify(msg))} />}
      </AnimatePresence>
    </main>
  )
}

function RolePicker({ value, onChange, allowInactive }) {
  return (
    <div role="radiogroup" aria-label="Access" className="grid gap-2">
      {ROLES.filter(([r]) => allowInactive || r !== 'inactive').map(([r, label, desc]) => (
        <label key={r} className={`flex cursor-pointer items-start gap-3 rounded-lg bg-paper p-3 ring-1 transition-shadow duration-150 ${value === r ? 'ring-2 ring-teal-deep' : 'ring-parchment'}`}>
          <input type="radio" name="role" value={r} checked={value === r} onChange={() => onChange(r)} className="mt-1 accent-teal-deep" />
          <span><span className="block font-bold">{label}</span><span className="text-sm text-bean">{desc}</span></span>
        </label>
      ))}
    </div>
  )
}

function NewLogin({ onClose, onDone }) {
  const [f, setF] = useState({ full_name: '', email: '', password: '', role: 'staff' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await serverApi('/api/staff', { action: 'create', ...f })
    setBusy(false)
    if (error) return setErr(error)
    onDone(f.full_name.trim())
  }
  return (
    <Sheet title="Add a login" subtitle="They sign in with this email and the temporary password." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className={LABEL}>Name<input value={f.full_name} onChange={set('full_name')} autoComplete="off" className={`${FIELD} mt-1.5`} /></label>
        <label className={LABEL}>Email<input type="email" value={f.email} onChange={set('email')} autoComplete="off" className={`${FIELD} mt-1.5`} /></label>
        <label className={LABEL}>
          Temporary password
          <input value={f.password} onChange={set('password')} autoComplete="new-password" minLength={8} className={`${FIELD} mt-1.5`} />
          <span className="mt-1 block text-xs font-normal text-bean">At least 8 characters. Tell them in person, not by chat.</span>
        </label>
        <RolePicker value={f.role} onChange={(role) => setF((x) => ({ ...x, role }))} />
        {err && <Problem>{err}</Problem>}
        <Submit busy={busy}>Create login</Submit>
      </form>
    </Sheet>
  )
}

function Person({ p, me, onClose, onDone }) {
  const [role, setRole] = useState(p.role)
  const [name, setName] = useState(p.full_name ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    setBusy('save')
    setErr(null)
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() || null, role }).eq('id', p.id)
    setBusy(null)
    if (error) return setErr(error.message)
    onDone(`${name.trim() || p.email} is now ${ROLE_LABEL[role].toLowerCase()}`)
  }
  const reset = async (e) => {
    e.preventDefault()
    setBusy('pw')
    setErr(null)
    const { error } = await serverApi('/api/staff', { action: 'password', user_id: p.id, password })
    setBusy(null)
    if (error) return setErr(error)
    setPassword('')
    onDone(`New password set for ${p.full_name || p.email}`)
  }

  return (
    <Sheet title={p.full_name || p.email} subtitle={p.email} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <label className={LABEL}>Name<input value={name} onChange={(e) => setName(e.target.value)} className={`${FIELD} mt-1.5`} /></label>
        {me && <p className="rounded-lg bg-parchment/60 px-3.5 py-2.5 text-sm text-bean">This is you. There always has to be at least one admin.</p>}
        <RolePicker value={role} onChange={setRole} allowInactive={!me} />
        <Submit busy={busy === 'save'} disabled={role === p.role && name === (p.full_name ?? '')}>Save</Submit>
      </form>
      <form onSubmit={reset} className="mt-8 space-y-3 border-t border-parchment pt-6">
        <h3 className="flex items-center gap-2 font-bold"><KeyRound className="size-4" aria-hidden="true" /> Set a new password</h3>
        <p className="text-sm text-bean">For a forgotten password. They can use it straight away.</p>
        <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} placeholder="At least 8 characters" autoComplete="new-password" aria-label="New password" className={FIELD} />
        <button type="submit" disabled={password.length < 8 || busy === 'pw'} className={`${BTN.quiet} w-full`}>Set password</button>
      </form>
      {err && <div className="mt-4"><Problem>{err}</Problem></div>}
    </Sheet>
  )
}
