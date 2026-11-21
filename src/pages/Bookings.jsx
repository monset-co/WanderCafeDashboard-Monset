import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  BedDouble, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, CircleX, Clock, DoorOpen, Flag, Hourglass, ListChecks,
  LogIn, LogOut, Mail, Pencil, Phone, Plus, Search, Settings2, StickyNote, TriangleAlert, Users, Wallet,
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { addDays, cents, fmtDateTime, fmtDay, intInput, manilaToday, moneyInput, nightsBetween, plural } from '../lib/util.js'
import { BTN, Badge, CARD, Chips, EASE_OUT, Empty, FIELD, HoldButton, Kpis, LABEL, PageHeader, Problem, Segmented, Sheet, SkeletonRows, Submit, useToast } from '../components/ui.jsx'
import { useAuth } from '../auth.jsx'
import { notifyTeam } from '../lib/device.js'

// ---- Words for every state: icon + label + tone, never colour alone ----
const STATUS = {
  pending: { label: 'Holding, unpaid', tone: 'warn', Icon: Hourglass },
  confirmed: { label: 'Confirmed', tone: 'info', Icon: CircleCheck },
  checked_in: { label: 'In house', tone: 'ok', Icon: DoorOpen },
  checked_out: { label: 'Checked out', tone: 'muted', Icon: Flag },
  cancelled: { label: 'Cancelled', tone: 'bad', Icon: CircleX },
  expired: { label: 'Hold expired', tone: 'muted', Icon: Clock },
  conflict: { label: 'Refund needed', tone: 'bad', Icon: TriangleAlert },
}
const SOURCE = { web: 'Website', walk_in: 'Walk-in', phone: 'Phone', facebook: 'Facebook', other: 'Other' }
const LIVE = ['pending', 'confirmed', 'checked_in'] // these hold the room (same rule as the database)
const StatusBadge = ({ status }) => <Badge tone={STATUS[status].tone} Icon={STATUS[status].Icon}>{STATUS[status].label}</Badge>
const payState = (b) => (b.total && b.paid >= b.total ? ['Paid in full', 'text-leaf'] : b.paid > 0 && b.paid >= b.deposit ? ['Deposit paid', 'text-teal-deep'] : ['Awaiting deposit', 'text-honey'])
const nightsOf = (b) => nightsBetween(b.check_in, b.check_out)
const stayLabel = (b) => `${fmtDay(b.check_in, { weekday: 'short', month: 'short', day: 'numeric' })} – ${fmtDay(b.check_out, { weekday: 'short', month: 'short', day: 'numeric' })} · ${plural(nightsOf(b), 'night')}`

// ---- Live data: every booking and room, refreshed when anything changes anywhere ----
function useBookingsData() {
  const [bookings, setBookings] = useState(null)
  const [rooms, setRooms] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    const [b, r] = await Promise.all([
      supabase.from('bookings').select('*').order('check_in'),
      supabase.from('rooms').select('*').order('sort').order('name'),
    ])
    if (b.error || r.error) return setError((b.error ?? r.error).message)
    setError(null)
    setBookings(b.data)
    setRooms(r.data)
  }, [])
  useEffect(() => {
    load()
    let t
    const ch = supabase
      .channel('bookings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        clearTimeout(t)
        t = setTimeout(load, 300)
      })
      .subscribe()
    return () => (clearTimeout(t), supabase.removeChannel(ch))
  }, [load])

  // Optimistic: the screen changes at once and rolls back to the server's copy if the save fails.
  const update = useCallback(
    async (id, patch) => {
      setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)))
      const { error } = await supabase.from('bookings').update(patch).eq('id', id)
      if (error) {
        load()
        throw new Error(error.code === '23P01' ? 'That room is already booked on those dates.' : error.message)
      }
    },
    [load],
  )
  return { bookings, rooms, error, load, update }
}

export default function Bookings() {
  const { isManager } = useAuth()
  const notify = useToast()
  const { bookings, rooms, error, load, update } = useBookingsData()
  const [tab, setTab] = useState('today')
  const [openId, setOpenId] = useState(null)
  const [form, setForm] = useState(null) // { booking } to edit, { checkIn } to add
  const [roomsOpen, setRoomsOpen] = useState(false)
  const t = manilaToday()
  const opened = bookings?.find((b) => b.id === openId) ?? null
  const roomById = useMemo(() => Object.fromEntries((rooms ?? []).map((r) => [r.id, r])), [rooms])

  // Apply a change, with an undo that puts the old values back (Sermon on the Mount dashboard).
  const act = (b, patch, msg) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, b[k]]))
    const failed = (e) => notify(e.message, { tone: 'bad' })
    update(b.id, patch).then(() => notify(msg, { undo: () => update(b.id, before).catch(failed) }), failed)
  }

  const holds = bookings?.filter((b) => b.status === 'pending' || b.status === 'conflict').length ?? 0

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader title="Bookings" sub={fmtDay(t, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}>
        {isManager && (
          <button type="button" onClick={() => setRoomsOpen(true)} className={BTN.quiet}>
            <Settings2 className="size-4" aria-hidden="true" /> Rooms
          </button>
        )}
        <button type="button" onClick={() => setForm({ checkIn: t })} disabled={!rooms?.length} className={BTN.primary}>
          <Plus className="size-4" aria-hidden="true" /> New booking
        </button>
      </PageHeader>

      <Segmented
        id="bk-tab"
        className="mt-6 sm:w-fit"
        value={tab}
        onChange={setTab}
        options={[['today', 'Today', BedDouble], ['list', `Bookings${holds ? ` · ${holds}` : ''}`, ListChecks], ['calendar', 'Calendar', CalendarDays]]}
      />

      {error && <div className="mt-4"><Problem onRetry={load}>Couldn't load bookings. {error}</Problem></div>}
      {!bookings && !error && <div className={`${CARD} mt-6`}><SkeletonRows label="Loading bookings" /></div>}

      {bookings && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, transform: 'translateY(6px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="mt-6"
          >
            {tab === 'today' && <Today bookings={bookings} rooms={rooms} roomById={roomById} open={setOpenId} act={act} />}
            {tab === 'list' && <List bookings={bookings} rooms={rooms} roomById={roomById} open={setOpenId} />}
            {tab === 'calendar' && <Calendar bookings={bookings} rooms={rooms} open={setOpenId} add={(d) => setForm({ checkIn: d })} />}
          </motion.div>
        </AnimatePresence>
      )}

      <AnimatePresence>
        {opened && (
          <BookingDrawer key="drawer" b={opened} room={roomById[opened.room_id]} isManager={isManager} act={act} onClose={() => setOpenId(null)} onEdit={() => setForm({ booking: opened })} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {form && (
          <BookingForm
            key="form"
            {...form}
            rooms={rooms}
            bookings={bookings}
            isManager={isManager}
            onClose={() => setForm(null)}
            onSaved={(b, created) => {
              setForm(null)
              load()
              if (created) setOpenId(b.id), notifyTeam({ kind: 'booking', id: b.id })
              notify(created ? `Booked ${b.name} · ${b.ref}` : `${b.name}’s booking saved`)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{roomsOpen && <RoomsSheet key="rooms" rooms={rooms} onClose={() => setRoomsOpen(false)} onSaved={load} />}</AnimatePresence>
    </main>
  )
}

// ---- Today: who's arriving, leaving and staying, and what's owed ----
function Today({ bookings, rooms, roomById, open, act }) {
  const t = manilaToday()
  const live = bookings.filter((b) => LIVE.includes(b.status))
  const arrivals = live.filter((b) => b.status !== 'checked_in' && b.check_in <= t && b.check_out > t)
  const departures = bookings.filter((b) => b.status === 'checked_in' && b.check_out <= t)
  const inHouse = bookings.filter((b) => b.status === 'checked_in' && b.check_out > t)
  const tonight = live.filter((b) => b.check_in <= t && b.check_out > t)
  const upcoming = live.filter((b) => b.check_in > t && b.check_in <= addDays(t, 7))
  const attention = bookings.filter((b) => b.status === 'pending' || b.status === 'conflict')
  const due = bookings.filter((b) => ['confirmed', 'checked_in'].includes(b.status)).reduce((s, b) => s + Math.max(b.total - b.paid, 0), 0)
  const active = rooms.filter((r) => r.is_active).length

  return (
    <div className="space-y-6">
      <Kpis
        items={[
          { label: 'Rooms taken tonight', value: `${tonight.length} of ${active}`, note: active ? `${Math.round((tonight.length / active) * 100)}% occupied` : 'Add rooms first' },
          { label: 'Arriving today', value: arrivals.length, note: arrivals.length ? arrivals.map((b) => b.name.split(' ')[0]).join(', ') : 'No check-ins due' },
          { label: 'Leaving today', value: departures.length, note: departures.length ? departures.map((b) => b.name.split(' ')[0]).join(', ') : 'No check-outs due' },
          { label: 'Balance to collect', value: due / 100, fmt: (v) => cents(v * 100), note: 'Confirmed and in-house stays' },
        ]}
      />
      {attention.length > 0 && <Group title="Needs attention" note="Website holds waiting for payment, and payments that arrived after the room was taken" list={attention} roomById={roomById} open={open} />}
      <div className="grid gap-6 xl:grid-cols-2">
        <Group title="Arriving" list={arrivals} roomById={roomById} open={open} empty="Nobody is due to check in today."
          action={(b) => b.status === 'confirmed' && <QuickBtn Icon={LogIn} onClick={() => act(b, { status: 'checked_in' }, `${b.name} checked in`)}>Check in</QuickBtn>} />
        <Group title="Leaving" list={departures} roomById={roomById} open={open} empty="Nobody is due to check out."
          action={(b) => <QuickBtn Icon={LogOut} onClick={() => act(b, { status: 'checked_out' }, `${b.name} checked out${b.paid < b.total ? ` · ${cents(b.total - b.paid)} still unpaid` : ''}`)}>Check out</QuickBtn>} />
        <Group title="Staying" list={inHouse} roomById={roomById} open={open} empty="No guests in house." />
        <Group title="Next 7 days" list={upcoming} roomById={roomById} open={open} empty="No arrivals this week yet." />
      </div>
    </div>
  )
}

function QuickBtn({ Icon, children, onClick }) {
  return (
    <button type="button" onClick={(e) => (e.stopPropagation(), onClick())} className="press flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-teal-deep px-3 text-sm font-bold text-paper hover:bg-[#264f4c]">
      <Icon className="size-4" aria-hidden="true" /> {children}
    </button>
  )
}

function Group({ title, note, list, roomById, open, empty, action }) {
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="flex items-baseline justify-between gap-3 border-b border-parchment/70 px-5 py-3.5">
        <div>
          <h2 className="font-bold">{title} <span className="tabular font-semibold text-bean">{list.length}</span></h2>
          {note && <p className="text-sm text-bean">{note}</p>}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-bean">{empty}</p>
      ) : (
        <ul className="divide-y divide-parchment/60">
          {list.map((b) => (
            <li key={b.id}>
              <div role="button" tabIndex={0} onClick={() => open(b.id)} onKeyDown={(e) => e.key === 'Enter' && open(b.id)} className="group flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors duration-150 outline-none hover:bg-cream focus-visible:bg-cream">
                <RoomDot room={roomById[b.room_id]} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold group-hover:underline group-hover:decoration-teal group-hover:underline-offset-4">{b.name}</p>
                  <p className="truncate text-xs text-bean">{roomById[b.room_id]?.name ?? b.room_id} · {stayLabel(b)} · {plural(b.guests, 'guest')}</p>
                </div>
                <div className="hidden flex-col items-end gap-0.5 sm:flex">
                  <StatusBadge status={b.status} />
                  {['confirmed', 'checked_in'].includes(b.status) && <span className={`text-xs font-bold ${payState(b)[1]}`}>{payState(b)[0]}</span>}
                </div>
                {action?.(b)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const RoomDot = ({ room }) => <span className="size-2.5 shrink-0 rounded-full" style={{ background: room?.color ?? '#77614f' }} aria-hidden="true" />

// ---- Every booking, filtered ----
const FILTERS = [
  ['upcoming', 'Upcoming'],
  ['house', 'In house'],
  ['attention', 'Needs attention'],
  ['past', 'Past'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
]
function List({ bookings, rooms, roomById, open }) {
  const t = manilaToday()
  const [filter, setFilter] = useState('upcoming')
  const [room, setRoom] = useState('all')
  const [q, setQ] = useState('')
  const match = (b, f) =>
    f === 'all' ? true
    : f === 'upcoming' ? ['pending', 'confirmed'].includes(b.status) && b.check_out > t
    : f === 'house' ? b.status === 'checked_in'
    : f === 'attention' ? b.status === 'pending' || b.status === 'conflict'
    : f === 'past' ? b.status === 'checked_out' || (b.status === 'confirmed' && b.check_out <= t)
    : ['cancelled', 'expired'].includes(b.status)
  const needle = q.trim().toLowerCase()
  const byRoom = (b) => room === 'all' || b.room_id === room
  const rows = bookings
    .filter((b) => match(b, filter) && byRoom(b) && (!needle || `${b.name} ${b.ref} ${b.phone} ${b.email}`.toLowerCase().includes(needle)))
    .sort((a, b) => (['past', 'cancelled', 'all'].includes(filter) ? b.check_in.localeCompare(a.check_in) : a.check_in.localeCompare(b.check_in)))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <Chips id="bk-filter" label="Filter bookings" value={filter} onChange={setFilter} options={FILTERS.map(([v, l]) => [v, l, bookings.filter((b) => match(b, v) && byRoom(b)).length])} />
        <label className="relative block xl:ml-auto xl:w-72">
          <span className="sr-only">Search bookings</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-bean" aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or WDR ref" className={`${FIELD} pl-10`} />
        </label>
      </div>
      {rooms.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by room">
          {[{ id: 'all', name: 'All rooms', color: '#4a3428' }, ...rooms].map((r) => {
            const on = room === r.id
            return (
              <button key={r.id} type="button" aria-pressed={on} onClick={() => setRoom(r.id)} className="press inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold" style={on ? { background: r.color, borderColor: r.color, color: '#fffcf7' } : { borderColor: `${r.color}55`, background: `${r.color}10` }}>
                <span className="size-2 rounded-full" style={{ background: on ? '#fffcf7' : r.color }} aria-hidden="true" />
                {r.name}
              </button>
            )
          })}
        </div>
      )}
      <div className={`${CARD} overflow-x-auto`}>
        {rows.length === 0 ? (
          <Empty>No bookings match{needle ? ` “${q}”` : ''}.</Empty>
        ) : (
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="border-b border-parchment text-xs font-bold tracking-[0.08em] text-bean uppercase">
              <tr>
                <th className="px-5 py-3 font-bold">Guest</th>
                <th className="px-3 py-3 font-bold">Room</th>
                <th className="px-3 py-3 font-bold">Stay</th>
                <th className="px-3 py-3 text-right font-bold">Total</th>
                <th className="px-5 py-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment/60">
              {rows.map((b) => (
                <tr key={b.id} tabIndex={0} onClick={() => open(b.id)} onKeyDown={(e) => e.key === 'Enter' && open(b.id)} className="group cursor-pointer transition-colors duration-150 outline-none hover:bg-cream focus-visible:bg-cream">
                  <td className="px-5 py-3">
                    <p className="font-bold group-hover:underline group-hover:decoration-teal group-hover:underline-offset-4">{b.name}</p>
                    <p className="tabular text-xs text-bean">{b.ref} · {SOURCE[b.source]}</p>
                  </td>
                  <td className="px-3 py-3"><span className="inline-flex items-center gap-2"><RoomDot room={roomById[b.room_id]} />{roomById[b.room_id]?.name ?? b.room_id}</span></td>
                  <td className="tabular px-3 py-3 text-bean">{stayLabel(b)}</td>
                  <td className="tabular px-3 py-3 text-right font-bold">{cents(b.total)}</td>
                  <td className="px-5 py-3">
                    <span className="flex flex-col items-start gap-0.5">
                      <StatusBadge status={b.status} />
                      {['confirmed', 'checked_in'].includes(b.status) && <span className={`text-xs font-bold ${payState(b)[1]}`}>{payState(b)[0]}</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ---- Month grid (Sermon on the Mount). Each stay is a chip in its room's colour with the guest's name;
// holds are hatched. Tapping a free day from today on starts a booking with that check-in. ----
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
function Calendar({ bookings, rooms, open, add }) {
  const t = manilaToday()
  const [key, setKey] = useState(t.slice(0, 7))
  const [dir, setDir] = useState(1)
  const go = (n) => {
    setDir(n)
    setKey((k) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7))
  }
  const first = new Date(key + '-01T00:00:00Z')
  const lead = (first.getUTCDay() + 6) % 7
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const days = Array.from({ length: count }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`)
  const order = Object.fromEntries(rooms.map((r, i) => [r.id, i]))
  const color = Object.fromEntries(rooms.map((r) => [r.id, r.color]))
  const byDay = new Map()
  const live = bookings.filter((b) => [...LIVE, 'checked_out'].includes(b.status)).sort((a, b) => (order[a.room_id] ?? 99) - (order[b.room_id] ?? 99))
  const monthEnd = days[days.length - 1]
  for (const b of live) {
    if (b.check_out <= days[0] || b.check_in > monthEnd) continue // only walk stays that touch this month
    for (let d = b.check_in; d < b.check_out; d = addDays(d, 1)) if (d.startsWith(key)) byDay.set(d, [...(byDay.get(d) ?? []), b])
  }
  const active = rooms.filter((r) => r.is_active).length
  const nights = [...byDay.values()].reduce((s, l) => s + l.length, 0)
  const occ = active ? Math.round((nights / (active * count)) * 100) : 0

  return (
    <div className={`${CARD} p-4 sm:p-6`}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go(-1)} className="press grid size-10 place-items-center rounded-lg ring-1 ring-parchment hover:ring-bean/40" aria-label="Previous month"><ChevronLeft className="size-5" aria-hidden="true" /></button>
          <h2 className="w-48 text-center font-display text-2xl font-semibold tracking-[-0.01em]" aria-live="polite">{fmtDay(key + '-01', { month: 'long', year: 'numeric' })}</h2>
          <button type="button" onClick={() => go(1)} className="press grid size-10 place-items-center rounded-lg ring-1 ring-parchment hover:ring-bean/40" aria-label="Next month"><ChevronRight className="size-5" aria-hidden="true" /></button>
          {key !== t.slice(0, 7) && <button type="button" onClick={() => (setDir(key < t ? 1 : -1), setKey(t.slice(0, 7)))} className="press ml-1 rounded-lg px-3 py-2 text-sm font-bold text-teal-deep hover:bg-teal/10">Today</button>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-bean">
          {rooms.filter((r) => r.is_active).map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: r.color }} aria-hidden="true" />{r.name}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-bean" style={{ backgroundImage: 'repeating-linear-gradient(45deg,#77614f55 0 1px,transparent 1px 3px)' }} aria-hidden="true" />Unpaid hold</span>
          <span className="tabular font-bold text-espresso">{occ}% occupied</span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[0.7rem] font-bold tracking-[0.08em] text-bean uppercase">
        {WEEK.map((w) => <span key={w} className="pb-1">{w}</span>)}
      </div>
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div
          key={key}
          initial={{ opacity: 0, transform: `translateX(${dir * 20}px)` }}
          animate={{ opacity: 1, transform: 'translateX(0px)' }}
          exit={{ opacity: 0, transform: `translateX(${dir * -20}px)`, transition: { duration: 0.14 } }}
          transition={{ duration: 0.28, ease: EASE_OUT }}
          className="grid grid-cols-7 gap-1.5"
        >
          {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
          {days.map((d) => {
            const list = byDay.get(d) ?? []
            const label = fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' })
            const full = list.length >= active
            const dayNum = <span className={`tabular text-xs font-bold ${d === t ? 'grid size-6 place-items-center rounded-full bg-espresso text-paper' : 'text-bean'}`}>{+d.slice(8)}</span>
            return (
              <div key={d} className={`group relative flex min-h-20 min-w-0 flex-col gap-1 rounded-xl p-1.5 ring-1 ring-parchment/70 sm:min-h-24 sm:p-2 ${d < t ? 'opacity-55' : ''}`}>
                {!full && d >= t ? (
                  <button type="button" onClick={() => add(d)} aria-label={`${label}: ${list.length ? `${active - list.length} free` : 'free'}. Add a booking`} className="press flex items-start justify-between rounded-md text-left">
                    {dayNum}
                    <Plus className="size-4 text-teal-deep opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden="true" />
                  </button>
                ) : dayNum}
                <span className="mt-auto flex flex-col gap-1">
                  {list.map((b) => {
                    const c = color[b.room_id] ?? '#77614f'
                    const starts = b.check_in === d || d.endsWith('-01')
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => open(b.id)}
                        aria-label={`${label}: ${b.name}, ${STATUS[b.status].label}`}
                        className="press min-w-0 truncate rounded-md border px-1.5 py-0.5 text-left text-[0.7rem] font-bold text-espresso"
                        style={b.status === 'pending' ? { borderColor: c, backgroundImage: `repeating-linear-gradient(45deg, ${c}30 0 2px, transparent 2px 7px)` } : { background: `${c}24`, borderColor: `${c}66` }}
                      >
                        <span className="mr-1 inline-block size-1.5 rounded-full align-middle" style={{ background: c }} aria-hidden="true" />
                        <span className="max-sm:sr-only">{starts ? b.name.split(' ')[0] : '·'}</span>
                      </button>
                    )
                  })}
                </span>
              </div>
            )
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ---- One booking: details, money, what can happen next, and its history ----
function actionsFor(b, t, isManager) {
  const balance = b.total - b.paid
  const out = []
  if (b.status === 'pending') out.push(['Mark confirmed', { status: 'confirmed' }, 'Booking confirmed', 'primary'])
  if (b.status === 'confirmed' && b.check_in <= t) out.push(['Check in', { status: 'checked_in' }, `${b.name} checked in`, 'primary'])
  if (b.status === 'checked_in') out.push(['Check out', { status: 'checked_out' }, `${b.name} checked out${balance > 0 ? ` · ${cents(balance)} still unpaid` : ''}`, balance > 0 ? 'quiet' : 'primary'])
  if (isManager && ['pending', 'confirmed', 'conflict'].includes(b.status)) out.push(['Cancel booking', { status: 'cancelled' }, 'Booking cancelled', 'danger'])
  return out
}

function BookingDrawer({ b, room, isManager, act, onClose, onEdit }) {
  const t = manilaToday()
  const [amount, setAmount] = useState('')
  const [history, setHistory] = useState(null)
  const [people, setPeople] = useState({})
  const balance = b.total - b.paid
  const canPay = ['pending', 'confirmed', 'checked_in', 'checked_out'].includes(b.status) && balance > 0
  useEffect(() => {
    supabase.from('profiles').select('id, full_name').then(({ data }) => setPeople(Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name]))))
  }, [])
  // `b` is a new object after every realtime reload, which arrives after the save and its history row commit.
  useEffect(() => {
    let live = true
    supabase.from('booking_changes').select('*').eq('booking_id', b.id).order('changed_at', { ascending: false }).limit(50).then(({ data }) => live && setHistory(data ?? []))
    return () => (live = false)
  }, [b])

  const pay = (e) => {
    e.preventDefault()
    const add = Math.round(Number(amount) * 100)
    if (!add) return
    act(b, { paid: b.paid + add }, `${cents(add)} recorded for ${b.name}`)
    setAmount('')
  }
  const actions = actionsFor(b, t, isManager)

  return (
    <Sheet
      title={b.name}
      subtitle={`${b.ref} · ${room?.name ?? b.room_id} · ${SOURCE[b.source]}`}
      onClose={onClose}
      header={
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <StatusBadge status={b.status} />
          {(isManager || !['cancelled', 'expired'].includes(b.status)) && (
            <button type="button" onClick={onEdit} className={`${BTN.quiet} h-9 text-sm`}>
              <Pencil className="size-4" aria-hidden="true" /> {isManager ? 'Edit' : 'Guest details'}
            </button>
          )}
        </div>
      }
      footer={
        actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map(([label, patch, msg, tone]) =>
              tone === 'danger' ? (
                // Motionbook B7: cancelling frees the room, so it takes a deliberate hold, not a tap.
                <HoldButton key={label} Icon={CircleX} doneLabel="Cancelled" className="sm:ml-auto" onConfirm={() => act(b, patch, msg)}>
                  {label}
                </HoldButton>
              ) : (
                <button key={label} type="button" onClick={() => act(b, patch, msg)} className={BTN[tone]}>
                  {label}
                </button>
              ),
            )}
          </div>
        )
      }
    >
      {b.status === 'conflict' && <div className="mb-4"><Problem>Paid after the hold lapsed and someone else got the room. Refund {cents(b.paid)} through PayMongo, then cancel.</Problem></div>}
      <ul className="space-y-3 text-sm">
        <li className="flex gap-3"><CalendarDays className="mt-0.5 size-[1.1rem] shrink-0 text-teal" aria-hidden="true" />{stayLabel(b)}</li>
        <li className="flex gap-3"><Users className="mt-0.5 size-[1.1rem] shrink-0 text-teal" aria-hidden="true" />{plural(b.guests, 'guest')}{room ? ` · room sleeps ${room.max_guests}` : ''}</li>
        {b.phone && <li className="flex gap-3"><Phone className="mt-0.5 size-[1.1rem] shrink-0 text-teal" aria-hidden="true" /><a href={`tel:${b.phone}`} className="underline decoration-parchment underline-offset-4 hover:decoration-teal">{b.phone}</a></li>}
        {b.email && <li className="flex gap-3"><Mail className="mt-0.5 size-[1.1rem] shrink-0 text-teal" aria-hidden="true" /><a href={`mailto:${b.email}`} className="underline decoration-parchment underline-offset-4 hover:decoration-teal">{b.email}</a></li>}
        {b.notes && <li className="flex gap-3"><StickyNote className="mt-0.5 size-[1.1rem] shrink-0 text-teal" aria-hidden="true" />“{b.notes}”</li>}
      </ul>

      <div className={`${CARD} mt-6 p-5`}>
        <dl className="tabular space-y-1.5 text-sm">
          <div className="flex justify-between text-bean"><dt>Total</dt><dd>{cents(b.total)}</dd></div>
          <div className="flex justify-between text-bean"><dt>Deposit</dt><dd>{cents(b.deposit)}</dd></div>
          <div className="flex justify-between font-bold"><dt>Paid</dt><dd>{cents(b.paid)}</dd></div>
          {balance > 0 && <div className="flex justify-between font-bold text-honey"><dt>Balance</dt><dd>{cents(balance)}</dd></div>}
        </dl>
        {b.total > 0 && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-parchment/70" role="progressbar" aria-label="Paid so far" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((Math.min(b.paid, b.total) / b.total) * 100)}>
            <motion.div className="h-full origin-left rounded-full bg-teal-deep" initial={false} animate={{ transform: `scaleX(${Math.min(b.paid / b.total, 1)})` }} transition={{ type: 'spring', bounce: 0, duration: 0.5 }} />
          </div>
        )}
        {canPay && (
          <form onSubmit={pay} className="mt-4 flex gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Payment received, in pesos</span>
              <input inputMode="decimal" value={amount} onChange={moneyInput(setAmount)} placeholder={`Amount received, e.g. ${b.paid < b.deposit ? (b.deposit - b.paid) / 100 : balance / 100}`} className={`${FIELD} tabular`} />
            </label>
            <button type="submit" disabled={!Number(amount)} className={BTN.primary}><Wallet className="size-4" aria-hidden="true" /> Record</button>
          </form>
        )}
        {canPay && (
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {b.paid < b.deposit && <button type="button" onClick={() => act(b, { paid: b.deposit }, `Deposit of ${cents(b.deposit)} recorded`)} className="press rounded-full px-3 py-1 font-bold text-teal-deep ring-1 ring-teal/30 hover:bg-teal/10">Deposit received</button>}
            <button type="button" onClick={() => act(b, { paid: b.total }, `${b.name} paid in full`)} className="press rounded-full px-3 py-1 font-bold text-teal-deep ring-1 ring-teal/30 hover:bg-teal/10">Paid in full</button>
          </div>
        )}
      </div>

      <h3 className="mt-7 text-sm font-bold tracking-[0.08em] text-bean uppercase">History</h3>
      {!history ? <SkeletonRows rows={3} h="h-12" /> : (
        <ol className="mt-3 space-y-3">
          {history.map((h) => (
            <li key={h.id} className="border-l-2 border-parchment pl-3 text-sm">
              <p className="font-semibold">{changeText(h)}</p>
              <p className="text-xs text-bean">{fmtDateTime(h.changed_at)} · {h.changed_by ? (people[h.changed_by] ?? 'Someone') : 'Website'}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-bean">Made {fmtDateTime(b.created_at)}</p>
    </Sheet>
  )
}

const CHANGE = { status: 'Status', paid: 'Paid', room_id: 'Room', check_in: 'Check-in', check_out: 'Check-out', guests: 'Guests', total: 'Total', deposit: 'Deposit', name: 'Name', phone: 'Phone', email: 'Email', notes: 'Notes' }
function changeText(h) {
  if (h.field === 'created') return `Booked (${STATUS[h.new_value]?.label ?? h.new_value})`
  const v = (x) => (x == null || x === '' ? '–' : ['paid', 'total', 'deposit'].includes(h.field) ? cents(x) : h.field === 'status' ? (STATUS[x]?.label ?? x) : x)
  return `${CHANGE[h.field] ?? h.field}: ${v(h.old_value)} → ${v(h.new_value)}`
}

// ---- New booking / edit. Price fills in from the room rate; the database refuses overlaps. ----
function BookingForm({ booking: b, checkIn, rooms, bookings, isManager, onClose, onSaved }) {
  const t = manilaToday()
  const active = rooms.filter((r) => r.is_active || r.id === b?.room_id)
  const [f, setF] = useState(() => ({
    room_id: b?.room_id ?? active[0]?.id ?? '',
    check_in: b?.check_in ?? checkIn ?? t,
    check_out: b?.check_out ?? addDays(checkIn ?? t, 1),
    guests: String(b?.guests ?? 2),
    name: b?.name ?? '',
    phone: b?.phone ?? '',
    email: b?.email ?? '',
    notes: b?.notes ?? '',
    source: b?.source ?? 'walk_in',
    total: b ? String(b.total / 100) : '',
    paid: '',
    status: 'confirmed',
  }))
  const [touchedTotal, setTouchedTotal] = useState(Boolean(b))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }))
  const room = rooms.find((r) => r.id === f.room_id)
  const nights = f.check_out > f.check_in ? nightsBetween(f.check_in, f.check_out) : 0
  const suggested = room ? room.rate * nights : 0
  const total = touchedTotal ? Number(f.total) || 0 : suggested
  const stayLocked = b && !isManager // staff edit guest details only (the database enforces it too)
  const clash = bookings.find((x) => x.id !== b?.id && x.room_id === f.room_id && LIVE.includes(x.status) && x.check_in < f.check_out && x.check_out > f.check_in)
  const tooMany = room && Number(f.guests) > room.max_guests

  const save = async (e) => {
    e.preventDefault()
    if (!room) return setErr('Pick a room.')
    if (!nights) return setErr('Check-out has to be after check-in.')
    if (f.name.trim().length < 2) return setErr('Enter the guest’s name.')
    if (!f.phone.trim() && !f.email.trim()) return setErr('Add a phone number or email so you can reach them.')
    setBusy(true)
    setErr(null)
    const totalC = Math.round(total * 100)
    const guest = { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), notes: f.notes.trim(), guests: Number(f.guests) || 1 }
    const stay = { room_id: f.room_id, check_in: f.check_in, check_out: f.check_out, total: totalC, deposit: Math.round(totalC / 2) }
    const res = b
      ? await supabase.from('bookings').update(stayLocked ? guest : { ...guest, ...stay }).eq('id', b.id).select().single()
      : await supabase.from('bookings').insert({ ...guest, ...stay, source: f.source, status: f.status, paid: Math.round((Number(f.paid) || 0) * 100) }).select().single()
    setBusy(false)
    if (res.error) return setErr(res.error.code === '23P01' ? `${room.name} is already booked on some of those nights.` : res.error.message)
    onSaved(res.data, !b)
  }

  return (
    <Sheet title={b ? 'Edit booking' : 'New booking'} subtitle={b ? `${b.ref} · ${b.name}` : 'Phone, walk-in or Facebook. Website bookings arrive by themselves.'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-5">
        <fieldset disabled={stayLocked} className="space-y-4">
          <legend className="sr-only">Stay</legend>
          {stayLocked && <p className="rounded-lg bg-parchment/60 px-3.5 py-2.5 text-sm text-bean">The room, dates and price are a manager’s call. You can update the guest details.</p>}
          <div role="radiogroup" aria-label="Room" className="grid gap-2 sm:grid-cols-2">
            {active.map((r) => (
              <label key={r.id} className={`flex cursor-pointer items-start gap-3 rounded-lg bg-paper p-3 ring-1 transition-shadow duration-150 ${f.room_id === r.id ? 'ring-2 ring-teal-deep' : 'ring-parchment'}`}>
                <input type="radio" name="room" value={r.id} checked={f.room_id === r.id} onChange={set('room_id')} className="mt-1 accent-teal-deep" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-bold"><RoomDot room={r} />{r.name}</span>
                  <span className="tabular text-sm text-bean">{r.bed} · sleeps {r.max_guests} · {cents(r.rate * 100)}/night</span>
                </span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_1fr_6rem] gap-3">
            <label className={LABEL}>Check-in<input type="date" value={f.check_in} onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, check_in: v, check_out: x.check_out > v ? x.check_out : addDays(v, 1) })) }} className={`${FIELD} tabular mt-1.5`} /></label>
            <label className={LABEL}>Check-out<input type="date" value={f.check_out} min={addDays(f.check_in, 1)} onChange={set('check_out')} className={`${FIELD} tabular mt-1.5`} /></label>
            <label className={LABEL}>Guests<input inputMode="numeric" value={f.guests} onChange={intInput(set('guests'))} className={`${FIELD} tabular mt-1.5`} /></label>
          </div>
          {clash && <Problem>{room?.name} is taken {fmtDay(clash.check_in)}–{fmtDay(clash.check_out)} by {clash.name} ({STATUS[clash.status].label.toLowerCase()}).</Problem>}
          {tooMany && <p className="text-sm font-semibold text-honey">{room.name} sleeps {room.max_guests}. Double-check the guest count.</p>}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${LABEL} sm:col-span-2`}>Guest name<input value={f.name} onChange={set('name')} autoComplete="off" className={`${FIELD} mt-1.5`} /></label>
          <label className={LABEL}>Phone<input type="tel" value={f.phone} onChange={set('phone')} placeholder="0917 123 4567" className={`${FIELD} mt-1.5`} /></label>
          <label className={LABEL}>Email <span className="font-normal text-bean">(optional)</span><input type="email" value={f.email} onChange={set('email')} className={`${FIELD} mt-1.5`} /></label>
          <label className={`${LABEL} sm:col-span-2`}>Notes <span className="font-normal text-bean">(optional)</span><input value={f.notes} onChange={set('notes')} placeholder="Late arrival, extra pillow, celebrating…" className={`${FIELD} mt-1.5`} /></label>
        </div>

        <fieldset disabled={stayLocked} className={`${CARD} space-y-4 p-4`}>
          <legend className="sr-only">Price and payment</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              Total for the stay (₱)
              <input inputMode="decimal" value={touchedTotal ? f.total : String(suggested)} onChange={(e) => (setTouchedTotal(true), moneyInput(set('total'))(e))} className={`${FIELD} tabular mt-1.5`} />
              <span className="mt-1 block text-xs font-normal text-bean">
                {room && nights ? `${plural(nights, 'night')} × ${cents(room.rate * 100)} = ${cents(suggested * 100)}` : 'Pick a room and dates'}
                {touchedTotal && total !== suggested && <button type="button" onClick={() => setTouchedTotal(false)} className="ml-2 font-bold text-teal-deep underline underline-offset-2">Use rate</button>}
              </span>
            </label>
            {!b && (
              <label className={LABEL}>
                Paid now (₱) <span className="font-normal text-bean">(optional)</span>
                <input inputMode="decimal" value={f.paid} onChange={moneyInput(set('paid'))} placeholder={`Deposit ${cents(Math.round(total * 50))}`} className={`${FIELD} tabular mt-1.5`} />
              </label>
            )}
          </div>
          {!b && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={LABEL}>
                Booked via
                <select value={f.source} onChange={set('source')} className={`${FIELD} mt-1.5`}>
                  {Object.entries(SOURCE).filter(([k]) => k !== 'web').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className={LABEL}>
                Status
                <select value={f.status} onChange={set('status')} className={`${FIELD} mt-1.5`}>
                  <option value="confirmed">Confirmed</option>
                  {f.check_in <= t && <option value="checked_in">Checked in now</option>}
                </select>
              </label>
            </div>
          )}
        </fieldset>

        {err && <Problem>{err}</Problem>}
        <Submit busy={busy} disabled={Boolean(clash) && !stayLocked}>{b ? 'Save booking' : `Book ${room?.name ?? ''}${nights ? ` · ${plural(nights, 'night')}` : ''}`}</Submit>
      </form>
    </Sheet>
  )
}

// ---- Rooms (managers): names, beds, capacity, rates, colours ----
const SWATCHES = ['#4f8f8a', '#b0703c', '#6a5a9e', '#3f7fc4', '#a84a5e', '#5f7f3a']
function RoomsSheet({ rooms, onClose, onSaved }) {
  const notify = useToast()
  const [editing, setEditing] = useState(null)
  return (
    <Sheet title="Rooms" subtitle="What guests can book. Rates are per night." onClose={onClose}>
      {editing ? (
        <RoomForm room={editing === 'new' ? null : editing} taken={rooms.map((r) => r.id)} onCancel={() => setEditing(null)} onSaved={(r) => (setEditing(null), onSaved(), notify(`${r.name} saved`))} />
      ) : (
        <>
          <ul className="space-y-2">
            {rooms.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setEditing(r)} className={`press ${CARD} flex w-full items-center gap-3 p-4 text-left hover:ring-bean/40`}>
                  <RoomDot room={r} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{r.name}{!r.is_active && <span className="ml-2 text-xs font-bold text-bean">Hidden</span>}</span>
                    <span className="tabular text-sm text-bean">{r.bed} · sleeps {r.max_guests} · {r.id}</span>
                  </span>
                  <span className="tabular font-bold">{cents(r.rate * 100)}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setEditing('new')} className={`${BTN.quiet} mt-4 w-full`}><Plus className="size-4" aria-hidden="true" /> Add a room</button>
          <p className="mt-4 text-xs text-bean">Room ids match the website’s rooms (src/data/rooms.js), so keep them the same once the website takes bookings.</p>
        </>
      )}
    </Sheet>
  )
}

function RoomForm({ room, taken, onCancel, onSaved }) {
  const [f, setF] = useState({ id: room?.id ?? '', name: room?.name ?? '', bed: room?.bed ?? '', max_guests: String(room?.max_guests ?? 2), rate: String(room?.rate ?? ''), color: room?.color ?? SWATCHES[taken.length % SWATCHES.length], is_active: room?.is_active ?? true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }))
  const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const save = async (e) => {
    e.preventDefault()
    const id = room?.id ?? (f.id || slug(f.name))
    if (!f.name.trim() || !id) return setErr('Name the room.')
    if (!room && taken.includes(id)) return setErr('Another room already uses that id.')
    setBusy(true)
    setErr(null)
    const row = { name: f.name.trim(), bed: f.bed.trim(), max_guests: Number(f.max_guests) || 1, rate: Math.round(Number(f.rate) || 0), color: f.color, is_active: f.is_active }
    const res = room ? await supabase.from('rooms').update(row).eq('id', room.id).select().single() : await supabase.from('rooms').insert({ ...row, id, sort: taken.length + 1 }).select().single()
    setBusy(false)
    if (res.error) return setErr(res.error.message)
    onSaved(res.data)
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <label className={LABEL}>Name<input value={f.name} onChange={set('name')} placeholder="Garden Room" className={`${FIELD} mt-1.5`} /></label>
      {!room && <label className={LABEL}>Id <span className="font-normal text-bean">(for the website)</span><input value={f.id} onChange={(e) => set('id')(slug(e.target.value))} placeholder={slug(f.name) || 'garden-room'} className={`${FIELD} mt-1.5`} /></label>}
      <div className="grid grid-cols-[1fr_6rem_8rem] gap-3">
        <label className={LABEL}>Bed<input value={f.bed} onChange={set('bed')} placeholder="Queen bed" className={`${FIELD} mt-1.5`} /></label>
        <label className={LABEL}>Sleeps<input inputMode="numeric" value={f.max_guests} onChange={intInput(set('max_guests'))} className={`${FIELD} tabular mt-1.5`} /></label>
        <label className={LABEL}>Rate (₱)<input inputMode="numeric" value={f.rate} onChange={intInput(set('rate'))} className={`${FIELD} tabular mt-1.5`} /></label>
      </div>
      <fieldset>
        <legend className={LABEL}>Calendar colour</legend>
        <div className="mt-2 flex gap-2">
          {SWATCHES.map((c) => (
            <button key={c} type="button" onClick={() => set('color')(c)} aria-label={`Colour ${c}`} aria-pressed={f.color === c} className={`press size-9 rounded-full ring-offset-2 ring-offset-cream ${f.color === c ? 'ring-2 ring-espresso' : ''}`} style={{ background: c }} />
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-3 text-sm font-semibold">
        <input type="checkbox" checked={!f.is_active} onChange={(e) => set('is_active')(!e.target.checked)} className="size-4 accent-teal-deep" />
        Hide this room (can’t be booked; past stays kept)
      </label>
      {err && <Problem>{err}</Problem>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={`${BTN.quiet} h-12 flex-1`}>Back</button>
        <Submit busy={busy} className="flex-[2]">{room ? 'Save room' : 'Add room'}</Submit>
      </div>
    </form>
  )
}
