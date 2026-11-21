import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { LatestUpdate } from '../components/LatestUpdate.jsx'
import { ArrowRight, BedDouble, Clock, LogIn, LogOut, PackageX } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { ORDER_TYPE, ORDER_TYPES, addDays, cents, fmtDay, manilaToday, money, pct, plural, receiptNo } from '../lib/util.js'
import { Badge, CARD, Kpis, PageHeader, Problem } from '../components/ui.jsx'
import { TYPE_ICON } from './Register.jsx'
import { useAuth } from '../auth.jsx'

const nowMinutes = () => {
  const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }).split(':').map(Number)
  return h * 60 + m
}
const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5)
const clock = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`
}
const greeting = () => {
  const h = Math.floor(nowMinutes() / 60)
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

// The admin and manager home: today at a glance, each part linking to where it's handled.
export default function Overview() {
  const { profile } = useAuth()
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const t = manilaToday()

  const load = useCallback(async () => {
    const [rep, board, bk, rooms, stock, shifts, people] = await Promise.all([
      supabase.rpc('sales_report', { p_from: t, p_to: t }),
      supabase.rpc('order_board'),
      supabase.from('bookings').select('id, ref, name, room_id, check_in, check_out, status, total, paid').in('status', ['pending', 'confirmed', 'checked_in']).lte('check_in', t).gte('check_out', t),
      supabase.from('rooms').select('id, name, color').eq('is_active', true),
      supabase.from('products').select('id, name, unit, stock_qty, reorder_level, kind').eq('is_active', true).neq('kind', 'made'),
      supabase.from('shifts').select('staff_id, start_time, end_time, station').eq('shift_date', t).order('start_time'),
      supabase.from('profiles').select('id, full_name'),
    ])
    const err = [rep, board, bk, rooms, stock, shifts, people].find((r) => r.error)?.error
    if (err) return setError(err.message)
    setError(null)
    setD({ rep: rep.data, board: board.data, bookings: bk.data, rooms: rooms.data, low: stock.data.filter((p) => p.stock_qty <= p.reorder_level), shifts: shifts.data, names: Object.fromEntries(people.data.map((p) => [p.id, p.full_name])) })
  }, [t])
  useEffect(() => {
    load()
    const i = setInterval(() => document.visibilityState === 'visible' && load(), 30000)
    return () => clearInterval(i)
  }, [load])

  const first = profile.full_name?.split(/[\s@]/)[0]
  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader title={`${greeting()}${first ? `, ${first}` : ''}.`} sub={fmtDay(t, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} />
      <LatestUpdate />
      {error && <div className="mt-6"><Problem onRetry={load}>Couldn't load today. {error}</Problem></div>}
      {!d && !error && (
        <div className="mt-6 space-y-6" role="status" aria-label="Loading today">
          <div className="skeleton h-28 rounded-xl" />
          <div className="grid gap-6 lg:grid-cols-2">{[0, 1, 2, 3].map((k) => <div key={k} className="skeleton h-56 rounded-xl" />)}</div>
        </div>
      )}
      {d && <Today d={d} t={t} />}
    </main>
  )
}

function Today({ d, t }) {
  const tot = d.rep.totals
  const prev = d.rep.previous
  const open = d.board.filter((o) => o.order_status === 'preparing').sort((a, b) => a.sold_at.localeCompare(b.sold_at))
  const oldest = open[0] ? Math.floor((Date.now() - new Date(open[0].sold_at)) / 60000) : 0
  const tonight = d.bookings.filter((b) => b.check_out > t)
  const arrivals = d.bookings.filter((b) => b.check_in === t && b.status !== 'checked_in')
  const departures = d.bookings.filter((b) => b.check_out === t && b.status === 'checked_in')
  const roomName = Object.fromEntries(d.rooms.map((r) => [r.id, r]))
  const now = nowMinutes()
  const types = Object.fromEntries((d.rep.types ?? []).map((x) => [x.type, x]))
  const diff = Number(tot.revenue) - Number(prev.revenue)

  return (
    <>
      <div className="mt-6">
        <Kpis
          items={[
            { label: 'Cafe sales today', value: Number(tot.revenue), fmt: money, note: prev.receipts ? `${diff >= 0 ? '+' : '−'}${money(Math.abs(diff))} vs yesterday` : `${plural(tot.receipts, 'receipt')}` },
            { label: 'In the kitchen', value: open.length, tone: oldest >= 25 ? 'text-tomato' : oldest >= 15 ? 'text-honey' : '', note: open.length ? `Oldest waiting ${oldest} min` : 'All caught up' },
            { label: 'Rooms tonight', value: `${tonight.length} of ${d.rooms.length}`, note: d.rooms.length ? `${pct(tonight.length, d.rooms.length)} occupied` : 'No rooms set up' },
            { label: 'Running low', value: d.low.length, tone: d.low.length ? 'text-honey' : '', note: d.low.length ? d.low.slice(0, 2).map((p) => p.name).join(', ') : 'Stock looks fine' },
          ]}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Block title="In the kitchen" to="/orders" link="Open orders">
          {open.length === 0 ? (
            <Quiet>No orders waiting.</Quiet>
          ) : (
            <ul className="divide-y divide-parchment/60">
              {open.slice(0, 6).map((o) => {
                const m = Math.floor((Date.now() - new Date(o.sold_at)) / 60000)
                const Icon = TYPE_ICON[o.order_type] ?? TYPE_ICON.dine_in
                return (
                  <li key={o.id} className="flex items-center gap-3 px-5 py-2.5">
                    <Icon className="size-4 shrink-0 text-teal" aria-label={ORDER_TYPE[o.order_type]} />
                    <span className="tabular w-16 shrink-0 font-bold">{receiptNo(o.sale_no)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-bean">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</span>
                    <Badge tone={m >= 25 ? 'bad' : m >= 15 ? 'warn' : 'muted'} Icon={Clock}>{m < 1 ? 'Now' : `${m} min`}</Badge>
                  </li>
                )
              })}
              {open.length > 6 && <li className="px-5 py-2.5 text-sm text-bean">+{open.length - 6} more</li>}
            </ul>
          )}
        </Block>

        <Block title="On shift today" to="/schedule" link="Schedule">
          {d.shifts.length === 0 ? (
            <Quiet>Nobody scheduled today. Add shifts on the Schedule.</Quiet>
          ) : (
            <ul className="divide-y divide-parchment/60">
              {d.shifts.map((s, k) => {
                const on = now >= toMin(s.start_time) && now < toMin(s.end_time)
                const later = now < toMin(s.start_time)
                return (
                  <li key={k} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="min-w-0 flex-1 truncate font-bold">{d.names[s.staff_id] ?? 'Someone'}</span>
                    <span className="text-sm text-bean">{s.station}</span>
                    <span className="tabular w-32 text-right text-sm">{clock(s.start_time)}–{clock(s.end_time)}</span>
                    <span className="w-20 text-right">{on ? <Badge tone="ok">On now</Badge> : later ? <Badge tone="info">Later</Badge> : <Badge>Done</Badge>}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Block>

        <Block title="Rooms today" to="/bookings" link="Bookings">
          {arrivals.length + departures.length + tonight.length === 0 ? (
            <Quiet>No guests today.</Quiet>
          ) : (
            <ul className="divide-y divide-parchment/60">
              {[...arrivals.map((b) => [b, LogIn, 'Arriving']), ...departures.map((b) => [b, LogOut, 'Leaving']), ...tonight.filter((b) => b.status === 'checked_in').map((b) => [b, BedDouble, 'Staying'])].map(([b, Icon, what]) => (
                <li key={b.id + what} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: roomName[b.room_id]?.color ?? '#77614f' }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate"><b>{b.name}</b> <span className="text-sm text-bean">· {roomName[b.room_id]?.name ?? b.room_id}</span></span>
                  {b.paid < b.total && <span className="tabular text-sm font-bold text-honey">{cents(b.total - b.paid)} due</span>}
                  <Badge tone={what === 'Arriving' ? 'info' : what === 'Leaving' ? 'warn' : 'ok'} Icon={Icon}>{what}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Today’s orders" to="/sales" link="Sales log">
          {Number(tot.receipts) === 0 ? (
            <Quiet>No sales yet today.</Quiet>
          ) : (
            <dl className="grid grid-cols-3 divide-x divide-parchment/70">
              {ORDER_TYPES.map(([v, label]) => {
                const Icon = TYPE_ICON[v]
                return (
                  <div key={v} className="px-5 py-4">
                    <dt className="flex items-center gap-1.5 text-sm font-semibold text-bean"><Icon className="size-4" aria-hidden="true" /> {label}</dt>
                    <dd className="tabular mt-1.5 font-display text-2xl leading-none font-semibold">{money(types[v]?.total ?? 0)}</dd>
                    <dd className="tabular mt-1 text-xs text-bean">{plural(Number(types[v]?.receipts ?? 0), 'order')}</dd>
                  </div>
                )
              })}
            </dl>
          )}
          {d.low.length > 0 && (
            <Link to="/inventory" className="flex items-center gap-2 border-t border-parchment/70 px-5 py-3 text-sm font-semibold text-honey hover:bg-cream">
              <PackageX className="size-4" aria-hidden="true" /> {plural(d.low.length, 'item')} running low: {d.low.slice(0, 3).map((p) => p.name).join(', ')}{d.low.length > 3 ? '…' : ''}
            </Link>
          )}
        </Block>
      </div>
      <p className="mt-4 text-xs text-bean">Updates every 30 seconds. Yesterday: {money(prev.revenue)} from {plural(Number(prev.receipts), 'receipt')} ({fmtDay(addDays(t, -1), { weekday: 'long' })}).</p>
    </>
  )
}

function Block({ title, to, link, children }) {
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 border-b border-parchment/70 px-5 py-3.5">
        <h2 className="font-bold">{title}</h2>
        <Link to={to} className="group inline-flex items-center gap-1 text-sm font-bold text-teal-deep">
          {link} <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
      {children}
    </section>
  )
}

const Quiet = ({ children }) => <p className="px-5 py-10 text-center text-sm text-bean">{children}</p>
