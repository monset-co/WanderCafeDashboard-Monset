import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Clock, NotebookPen, RotateCcw, UserRound } from 'lucide-react'
import { Link } from 'react-router'
import { LatestUpdate } from '../components/LatestUpdate.jsx'
import { supabase } from '../lib/supabase.js'
import { ORDER_TYPE, ORDER_TYPES, receiptNo } from '../lib/util.js'
import { BTN, CARD, Chips, PageHeader, Problem, useToast } from '../components/ui.jsx'
import { TYPE_ICON } from './Register.jsx'

const time = (t) => new Date(t).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })
const mins = (from, to = Date.now()) => Math.max(0, Math.floor((new Date(to) - new Date(from)) / 60000))
// Waiting time as words and a tone: on time, getting long, overdue.
const wait = (m) => (m >= 25 ? ['bg-tomato/10 text-tomato', `${m} min`] : m >= 15 ? ['bg-honey/12 text-honey', `${m} min`] : ['bg-parchment/70 text-bean', m < 1 ? 'Just now' : `${m} min`])

// The kitchen and counter's board: every order rung up today, preparing until someone taps Done.
export default function Orders() {
  const notify = useToast()
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [type, setType] = useState('all')
  const [, tick] = useState(0)

  const saving = useRef(0) // a poll that lands mid-save would flash the card back
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('order_board')
    if (saving.current) return
    if (error) return setError(error.message)
    setError(null)
    setOrders(data)
  }, [])
  // ponytail: polls every 5s (staff can't receive each other's sales over realtime, RLS); fine for one cafe.
  useEffect(() => {
    load()
    const poll = setInterval(() => document.visibilityState === 'visible' && load(), 5000)
    const clock = setInterval(() => tick((n) => n + 1), 30000)
    const wake = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', wake)
    return () => (clearInterval(poll), clearInterval(clock), document.removeEventListener('visibilitychange', wake))
  }, [load])

  // Optimistic: the card moves at once and goes back if the save fails.
  const setStatus = async (o, status) => {
    const patch = { order_status: status, completed_at: status === 'completed' ? new Date().toISOString() : null }
    setOrders((os) => os.map((x) => (x.id === o.id ? { ...x, ...patch } : x)))
    saving.current++
    const { error } = await supabase.rpc('set_order_status', { p_sale_id: o.id, p_status: status })
    saving.current--
    if (error) {
      notify(error.message, { tone: 'bad' })
      return load()
    }
    if (status === 'completed') notify(`${receiptNo(o.sale_no)} done`, { undo: () => setStatus(o, 'preparing') })
  }

  const list = (orders ?? []).filter((o) => type === 'all' || o.order_type === type)
  const preparing = list.filter((o) => o.order_status === 'preparing').sort((a, b) => a.sold_at.localeCompare(b.sold_at))
  const done = list.filter((o) => o.order_status === 'completed').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const openCount = (t) => (orders ?? []).filter((o) => o.order_status === 'preparing' && (t === 'all' || o.order_type === t)).length

  return (
    <main className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader title="Orders" sub="Oldest first. Tap Done when an order is served, picked up or out for delivery.">
        <Link to="/register" className={BTN.primary}>New order</Link>
      </PageHeader>
      <LatestUpdate />
      <div className="mt-6">
        <Chips id="ord-type" label="Order type" value={type} onChange={setType} options={[['all', 'All', openCount('all')], ...ORDER_TYPES.map(([v, l]) => [v, l, openCount(v)])]} />
      </div>
      {error && <div className="mt-4"><Problem onRetry={load}>Couldn't load orders. {error}</Problem></div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="col-prep">
          <h2 id="col-prep" className="mb-3 flex items-baseline gap-2 font-display text-2xl font-semibold tracking-[-0.01em]">
            Preparing <span className="tabular font-sans text-base font-bold text-bean">{orders ? preparing.length : ''}</span>
          </h2>
          {!orders && !error && <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((k) => <div key={k} className="skeleton h-44 rounded-xl" style={{ animationDelay: `${k * 70}ms` }} />)}</div>}
          {orders && preparing.length === 0 && (
            <div className={`${CARD} grid min-h-44 place-items-center p-8 text-center text-bean`}>
              <p><b className="block text-lg text-espresso">All caught up</b>New orders from the register show up here.</p>
            </div>
          )}
          <motion.ul layout className="grid gap-3 sm:grid-cols-2">
            <AnimatePresence mode="popLayout" initial={false}>
              {preparing.map((o) => <OrderCard key={o.id} o={o} onDone={() => setStatus(o, 'completed')} />)}
            </AnimatePresence>
          </motion.ul>
        </section>

        <section aria-labelledby="col-done">
          <h2 id="col-done" className="mb-3 flex items-baseline gap-2 font-display text-2xl font-semibold tracking-[-0.01em]">
            Completed today <span className="tabular font-sans text-base font-bold text-bean">{orders ? done.length : ''}</span>
          </h2>
          {orders && done.length === 0 && <p className={`${CARD} px-5 py-10 text-center text-bean`}>Nothing completed yet today.</p>}
          <motion.ul layout className="grid gap-2">
            <AnimatePresence mode="popLayout" initial={false}>
              {done.map((o) => <DoneCard key={o.id} o={o} onUndo={() => setStatus(o, 'preparing')} />)}
            </AnimatePresence>
          </motion.ul>
        </section>
      </div>
    </main>
  )
}

// Shared layoutId: a card slides from Preparing into Completed instead of vanishing and reappearing.
const move = { layout: true, transition: { type: 'spring', duration: 0.38, bounce: 0 } }

function TypeTag({ type }) {
  const Icon = TYPE_ICON[type] ?? TYPE_ICON.dine_in
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-teal/12 px-2.5 py-1 text-xs font-bold text-teal-deep">
      <Icon className="size-3.5" aria-hidden="true" /> {ORDER_TYPE[type] ?? 'Dine-in'}
    </span>
  )
}

function OrderCard({ o, onDone }) {
  const m = mins(o.sold_at)
  const [tone, label] = wait(m)
  const fresh = m < 1
  return (
    <motion.li
      layoutId={o.id}
      {...move}
      initial={{ opacity: 0, transform: 'scale(0.96)' }}
      animate={{ opacity: 1, transform: 'scale(1)' }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className={`${CARD} flex flex-col p-4 ${fresh ? 'ring-2 ring-tiffany' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="tabular font-display text-3xl leading-none font-semibold tracking-[-0.02em]">{receiptNo(o.sale_no)}</p>
          <p className="mt-1.5 text-xs text-bean">{time(o.sold_at)} · {o.staff_name}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <TypeTag type={o.order_type} />
          <span className={`tabular inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
            <Clock className="size-3.5" aria-hidden="true" /> {label}
          </span>
        </div>
      </div>
      {o.customer_name && (
        <p className="mt-3 flex items-start gap-1.5 text-sm font-bold">
          <UserRound className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden="true" /> {o.customer_name}
        </p>
      )}
      <ul className="mt-3 flex-1 space-y-1 border-t border-dashed border-parchment pt-3">
        {o.items.map((i, k) => (
          <li key={k} className="flex gap-2 text-[0.95rem] leading-snug">
            <span className="tabular w-7 shrink-0 font-extrabold text-teal-deep">{i.qty}×</span>
            <span className="font-semibold">{i.name}</span>
          </li>
        ))}
      </ul>
      {o.note && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-honey/10 px-3 py-2 text-sm font-semibold text-honey">
          <NotebookPen className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {o.note}
        </p>
      )}
      <button type="button" onClick={onDone} className={`${BTN.primary} mt-4 h-12 w-full text-base`}>
        <Check className="size-5" aria-hidden="true" /> Done
      </button>
    </motion.li>
  )
}

function DoneCard({ o, onUndo }) {
  return (
    <motion.li
      layoutId={o.id}
      {...move}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className={`${CARD} flex items-center gap-3 px-4 py-3`}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-leaf/12 text-leaf"><Check className="size-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">
          <span className="tabular">{receiptNo(o.sale_no)}</span> · {ORDER_TYPE[o.order_type] ?? 'Dine-in'}{o.customer_name ? ` · ${o.customer_name}` : ''}
        </p>
        <p className="tabular truncate text-xs text-bean">
          {o.completed_at ? `Done ${time(o.completed_at)} · ${mins(o.sold_at, o.completed_at)} min` : 'Done'} · {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
        </p>
      </div>
      <button type="button" onClick={onUndo} title="Back to preparing" aria-label={`Move ${receiptNo(o.sale_no)} back to preparing`} className="press grid size-9 shrink-0 place-items-center rounded-lg text-bean ring-1 ring-parchment hover:text-espresso">
        <RotateCcw className="size-4" aria-hidden="true" />
      </button>
    </motion.li>
  )
}
