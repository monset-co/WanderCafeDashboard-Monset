import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Megaphone, Pin, PinOff, Send, Trash2, UsersRound } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { notifyTeam } from '../lib/device.js'
import { getSeen, markUpdatesSeen, useUpdatesFeed } from '../lib/updates.js'
import { fmtDateTime } from '../lib/util.js'
import { Badge, CARD, EASE_OUT, FIELD, LABEL, PageHeader, Problem, Segmented, SkeletonRows, Submit, useToast } from '../components/ui.jsx'
import { DeviceCard } from '../components/DeviceButtons.jsx'
import { useAuth } from '../auth.jsx'

// Notes from the admin to the team. Admins post; everyone reads what's meant for them.
export default function Updates() {
  const { isAdmin, session } = useAuth()
  const notify = useToast()
  const [posts, setPosts] = useState(null)
  const [names, setNames] = useState({})
  const [error, setError] = useState(null)
  const [seenBefore] = useState(() => getSeen(session.user.id))
  const { posts: feed } = useUpdatesFeed() // the app's one live subscription; reload when it changes

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100)
    if (error) return setError(error.message)
    setError(null)
    setPosts(data)
  }, [])
  useEffect(() => {
    supabase.from('profiles').select('id, full_name').then(({ data }) => setNames(Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name]))))
  }, [])
  useEffect(() => {
    load()
    markUpdatesSeen(session.user.id)
  }, [load, feed, session.user.id])

  const pin = async (p) => {
    const { error } = await supabase.from('announcements').update({ pinned: !p.pinned }).eq('id', p.id)
    if (error) return notify(error.message, { tone: 'bad' })
    load()
  }
  const remove = async (p) => {
    const { error } = await supabase.from('announcements').delete().eq('id', p.id)
    if (error) return notify(error.message, { tone: 'bad' })
    load()
    const { id, ...rest } = p // eslint-disable-line no-unused-vars
    notify(`“${p.title}” removed`, { undo: () => supabase.from('announcements').insert(rest).then(load) })
  }

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader title="Updates" sub={isAdmin ? 'Post notes for the team. Pinned ones stay on top.' : 'Notes from the admin. New ones also show on the order board.'} />
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {isAdmin && <Composer onPosted={load} />}
          {error && <Problem onRetry={load}>Couldn't load updates. {error}</Problem>}
          {!posts && !error && <div className={CARD}><SkeletonRows rows={3} label="Loading updates" /></div>}
          {posts?.length === 0 && (
            <div className={`${CARD} grid min-h-40 place-items-center p-8 text-center text-bean`}>
              <p><Megaphone className="mx-auto mb-2 size-6 text-teal" aria-hidden="true" />{isAdmin ? 'Nothing posted yet. Your first update will show here and on everyone’s order board.' : 'No updates yet.'}</p>
            </div>
          )}
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {posts?.map((p) => (
                <motion.li
                  key={p.id}
                  layout
                  initial={{ opacity: 0, transform: 'translateY(-8px)' }}
                  animate={{ opacity: 1, transform: 'translateY(0px)' }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.25, ease: EASE_OUT }}
                  className={`${CARD} p-5 ${p.pinned ? 'ring-2 ring-tiffany' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-lg leading-snug font-bold text-pretty">
                        {p.created_at > seenBefore && <span className="mr-2 inline-block size-2 rounded-full bg-teal align-middle" aria-label="New" />}
                        {p.title}
                      </h2>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-bean">
                        {names[p.created_by] ?? 'Admin'} · {fmtDateTime(p.created_at)}
                        {p.pinned && <Badge tone="info" Icon={Pin}>Pinned</Badge>}
                        {p.audience === 'managers' && <Badge tone="warn" Icon={UsersRound}>Managers only</Badge>}
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => pin(p)} title={p.pinned ? 'Unpin' : 'Pin to top'} aria-label={p.pinned ? 'Unpin' : 'Pin to top'} className="press grid size-9 place-items-center rounded-lg text-bean ring-1 ring-parchment hover:text-espresso">
                          {p.pinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
                        </button>
                        <button type="button" onClick={() => remove(p)} title="Remove" aria-label="Remove" className="press grid size-9 place-items-center rounded-lg text-tomato ring-1 ring-tomato/25 hover:bg-tomato/10">
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                  {p.body && <p className="mt-3 max-w-prose whitespace-pre-line text-[0.95rem] leading-relaxed">{p.body}</p>}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
        <aside className="lg:sticky lg:top-8">
          <DeviceCard />
        </aside>
      </div>
    </main>
  )
}

function Composer({ onPosted }) {
  const notify = useToast()
  const [f, setF] = useState({ title: '', body: '', audience: 'all', pinned: false, push: true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const post = async (e) => {
    e.preventDefault()
    if (!f.title.trim()) return setErr('Give it a title.')
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.from('announcements').insert({ title: f.title.trim(), body: f.body.trim(), audience: f.audience, pinned: f.pinned }).select('id').single()
    if (error) return setBusy(false), setErr(error.message)
    let sent = null
    if (f.push) sent = await notifyTeam({ kind: 'announcement', id: data.id })
    setBusy(false)
    setF({ title: '', body: '', audience: 'all', pinned: false, push: true })
    onPosted()
    notify(f.push && sent?.data ? `Posted · notified ${sent.data.sent} device${sent.data.sent === 1 ? '' : 's'}` : f.push && sent?.error ? `Posted. Notifications didn’t send: ${sent.error}` : 'Posted')
  }
  return (
    <form onSubmit={post} className={`${CARD} space-y-4 p-5`}>
      <label className={LABEL}>
        Title
        <input value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} maxLength={120} placeholder="Pho is back on the menu Monday" className={`${FIELD} mt-1.5`} />
      </label>
      <label className={LABEL}>
        Message <span className="font-normal text-bean">(optional)</span>
        <textarea value={f.body} onChange={(e) => setF((x) => ({ ...x, body: e.target.value }))} rows={3} maxLength={4000} placeholder="Details, reminders, who to ask…" className={`${FIELD} mt-1.5 h-auto min-h-24 py-2.5 leading-relaxed`} />
      </label>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Segmented id="audience" className="w-full sm:w-auto" value={f.audience} onChange={(audience) => setF((x) => ({ ...x, audience }))} options={[['all', 'Everyone'], ['managers', 'Managers only']]} />
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={f.pinned} onChange={(e) => setF((x) => ({ ...x, pinned: e.target.checked }))} className="size-4 accent-teal-deep" /> Pin to top
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={f.push} onChange={(e) => setF((x) => ({ ...x, push: e.target.checked }))} className="size-4 accent-teal-deep" /> Send a notification
        </label>
      </div>
      {err && <Problem>{err}</Problem>}
      <Submit busy={busy}>{!busy && <Send className="size-4" aria-hidden="true" />} Post update</Submit>
    </form>
  )
}
