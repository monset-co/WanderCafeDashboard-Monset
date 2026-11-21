import { useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router'
import { motion } from 'motion/react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { METHOD, addDays, fmtDay, money, monthStart, pct, plural, shortPeso } from '../lib/util.js'
import { Empty, Kpis, PageHeader, Panel, Problem, RangePicker, presets, rangeLabel } from '../components/ui.jsx'

// Teal = profit and sales, tomato = money out. Red vs blue-green stays apart for colour-blind readers,
// and every chart has words (legend, labels, a table) so colour is never the only cue.
const C = { profit: '#2f625e', cost: '#b3412e', one: '#4f8f8a', grid: '#eadfd0', axis: '#77614f', ink: '#4a3428' }
const RAMP = ['#e3f4f1', '#bfe8e3', '#93dcd4', '#5fb9b0', '#3b8f88', '#2f625e'] // sequential teal, light → dark
const num = (v) => Number(v) || 0
const axis = { stroke: C.axis, fontSize: 12, tickLine: false, axisLine: false }

// Days for short ranges, weeks (from Monday) up to ~7 months, then months.
function bucketize(rows, keys, maxDays = 62) {
  const unit = rows.length <= maxDays ? 'day' : rows.length <= 210 ? 'week' : 'month'
  const out = new Map()
  for (const r of rows) {
    const dow = (new Date(r.date + 'T00:00:00Z').getUTCDay() + 6) % 7
    const k = unit === 'day' ? r.date : unit === 'week' ? addDays(r.date, -dow) : monthStart(r.date)
    const b = out.get(k) ?? Object.fromEntries([['date', k], ...keys.map((x) => [x, 0])])
    keys.forEach((x) => (b[x] += num(r[x])))
    out.set(k, b)
  }
  const label = (d) => (unit === 'month' ? fmtDay(d, { month: 'short', year: '2-digit' }) : unit === 'week' ? `Wk of ${fmtDay(d)}` : fmtDay(d))
  return { unit, data: [...out.values()].map((b) => ({ ...b, label: label(b.date) })) }
}

const TABS = [
  ['Overview', '/analytics'],
  ['Menu', '/analytics/menu'],
  ['Staff', '/analytics/staff'],
  ['Rooms', '/analytics/rooms'],
]

export default function Analytics() {
  const opts = useMemo(presets, [])
  const [range, setRange] = useState({ key: '30d', from: opts[2][2], to: opts[2][3] })
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    setError(null)
    Promise.all([
      supabase.rpc('sales_report', { p_from: range.from, p_to: range.to }),
      supabase.rpc('stock_report', { p_from: range.from, p_to: range.to }),
      supabase.rpc('bookings_report', { p_from: range.from, p_to: range.to }),
    ]).then(([s, st, b]) => {
      if (!live) return
      const err = s.error ?? st.error ?? b.error
      if (err) setError(err.message)
      else setReport({ ...s.data, stock: st.data, rooms: b.data })
    })
    return () => (live = false)
  }, [range.from, range.to])

  const stale = report && (report.from !== range.from || report.to !== range.to)

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader title="Analytics" sub={rangeLabel(range)}>
        <RangePicker opts={opts} range={range} setRange={setRange} />
      </PageHeader>

      <nav aria-label="Analytics" className="mt-6 flex gap-1 overflow-x-auto border-b border-parchment">
        {TABS.map(([label, to]) => (
          <NavLink key={label} to={to} end className="relative shrink-0 px-4 pt-1 pb-3 text-sm font-bold">
            {({ isActive }) => (
              <>
                <span className={`transition-colors duration-150 ${isActive ? 'text-espresso' : 'text-bean hover:text-espresso'}`}>{label}</span>
                {isActive && <motion.span layoutId="an-tab" className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-teal" transition={{ type: 'spring', duration: 0.3, bounce: 0 }} />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {error && <div className="mt-6"><Problem>Couldn't load the report. {error}</Problem></div>}
      {!report && !error && <Skeleton />}
      {report && (
        <div className={`transition-opacity duration-200 ${stale ? 'opacity-50' : ''}`} aria-busy={stale}>
          <Routes>
            <Route index element={<Overview r={report} />} />
            <Route path="menu" element={<MenuTab r={report} />} />
            <Route path="staff" element={<StaffTab r={report} />} />
            <Route path="rooms" element={<RoomsTab r={report.rooms} />} />
          </Routes>
        </div>
      )}
    </main>
  )
}

function Skeleton() {
  return (
    <div className="mt-6 space-y-6" role="status" aria-label="Loading the report">
      <div className="skeleton h-28 rounded-xl" />
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="skeleton h-80 rounded-xl xl:col-span-3" />
        <div className="skeleton h-80 rounded-xl xl:col-span-2" />
      </div>
    </div>
  )
}

function Delta({ now, before, fmt = (v) => Math.round(v).toLocaleString('en-PH'), upIsGood = true }) {
  if (!before && !now) return <span>No change vs the period before</span>
  if (!before) return <span>New vs the period before</span>
  const d = now - before
  const p = Math.round((d / Math.abs(before)) * 100)
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus
  const good = d === 0 ? null : d > 0 === upIsGood
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className={`size-3.5 ${good === null ? '' : good ? 'text-leaf' : 'text-tomato'}`} aria-hidden="true" />
      {d >= 0 ? '+' : '−'}{fmt(Math.abs(d))} ({p >= 0 ? '+' : ''}{p}%) vs before
    </span>
  )
}

function Tip({ active, payload, label, fmt = (v) => v, total = false }) {
  if (!active || !payload?.length) return null
  const sum = payload.reduce((s, p) => s + num(p.value), 0)
  return (
    <div className="rounded-lg bg-roast px-3 py-2 text-sm text-paper shadow-[0_10px_28px_-10px_rgb(51_36_28/0.6)]">
      <p className="text-xs text-foam">{payload[0]?.payload?.label ?? label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="tabular flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
          {p.name}: <b>{fmt(p.value)}</b>
        </p>
      ))}
      {total && payload.length > 1 && <p className="tabular mt-1 border-t border-paper/15 pt-1 text-foam">Sales: <b className="text-paper">{fmt(sum)}</b></p>}
    </div>
  )
}

function Legend({ items }) {
  return (
    <p className="flex flex-wrap justify-end gap-4 text-sm text-bean">
      {items.map(([n, c]) => (
        <span key={n} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: c }} aria-hidden="true" />{n}</span>
      ))}
    </p>
  )
}

// Sale total per bar, split into what the food cost and the profit kept.
function SalesChart({ rows }) {
  const { unit, data } = bucketize(rows, ['revenue', 'profit', 'receipts'])
  const chart = data.map((d) => ({ ...d, cost: Math.max(d.revenue - d.profit, 0), profit: Math.min(d.profit, d.revenue) }))
  if (!chart.some((d) => d.revenue)) return <Empty>No sales in this range yet.</Empty>
  return (
    <>
      <Legend items={[['Cost of food & goods', C.cost], ['Gross profit', C.profit]]} />
      <div className="mt-2 h-72">
        <ResponsiveContainer>
          <BarChart data={chart} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap={chart.length > 20 ? 2 : '20%'}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={24} />
            <YAxis {...axis} width={52} tickFormatter={shortPeso} />
            <Tooltip cursor={{ fill: 'rgb(74 52 40 / 0.05)' }} content={<Tip fmt={money} total />} />
            <Bar dataKey="cost" name="Cost" stackId="s" fill={C.cost} stroke="#fffcf7" strokeWidth={1} maxBarSize={40} animationDuration={600} />
            <Bar dataKey="profit" name="Profit" stackId="s" fill={C.profit} stroke="#fffcf7" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={600} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-bean hover:text-espresso">View as table</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="tabular w-full text-left">
            <thead className="text-xs tracking-[0.08em] text-bean uppercase">
              <tr><th className="py-1.5 font-bold">{unit === 'day' ? 'Day' : unit === 'week' ? 'Week' : 'Month'}</th><th className="py-1.5 text-right font-bold">Receipts</th><th className="py-1.5 text-right font-bold">Sales</th><th className="py-1.5 text-right font-bold">Profit</th></tr>
            </thead>
            <tbody className="divide-y divide-parchment/60">
              {data.map((d) => <tr key={d.date}><td className="py-1.5">{d.label}</td><td className="py-1.5 text-right">{d.receipts}</td><td className="py-1.5 text-right">{money(d.revenue)}</td><td className="py-1.5 text-right">{money(d.profit)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}

// One series, one colour; value labels at the bar end. rows: [{ name, value }]
function HBars({ rows, fmt = money, color = C.one }) {
  if (!rows.length) return <Empty>Nothing in this range.</Empty>
  return (
    <div style={{ height: Math.max(120, rows.length * 40) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 72, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" {...axis} width={150} tick={{ fill: C.ink, fontSize: 13 }} />
          <Tooltip cursor={{ fill: 'rgb(74 52 40 / 0.05)' }} content={<Tip fmt={fmt} />} />
          <Bar dataKey="value" name="Value" fill={color} radius={[0, 4, 4, 0]} barSize={18} animationDuration={600}>
            <LabelList dataKey="value" position="right" fontSize={12} fill={C.ink} formatter={fmt} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_IDX = [1, 2, 3, 4, 5, 6, 0]
const HOURS = Array.from({ length: 16 }, (_, k) => k + 6) // 6 AM .. 9 PM
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`

function Heatmap({ hours }) {
  const [hover, setHover] = useState(null)
  const grid = DOW_IDX.map((d) => HOURS.map((h) => num(hours.find((x) => x.dow === d && x.hour === h)?.receipts)))
  const max = Math.max(1, ...grid.flat())
  const step = (v) => (v <= 0 ? null : RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1e-9)))])
  if (!hours.length) return <Empty>No sales in this range yet.</Empty>
  return (
    <div>
      <p className="tabular h-5 text-sm font-semibold" aria-live="polite">
        {hover ? `${DOWS[hover.r]} ${hourLabel(HOURS[hover.c])}m · ${plural(grid[hover.r][hover.c], 'receipt')}` : <span className="font-normal text-bean">Hover a cell for the count</span>}
      </p>
      <div className="mt-2 grid grid-cols-[2.5rem_repeat(16,minmax(0,1fr))] gap-[2px]" role="table" aria-label="Receipts by day and hour">
        <span />
        {HOURS.map((h) => <span key={h} className="pb-1 text-center text-[0.68rem] text-bean">{h % 3 === 0 ? hourLabel(h) : ''}</span>)}
        {grid.map((row, r) => (
          <div key={r} role="row" className="contents">
            <span role="rowheader" className="self-center text-xs font-semibold text-bean">{DOWS[r]}</span>
            {row.map((v, c) => (
              <span key={c} role="cell" aria-label={`${DOWS[r]} ${hourLabel(HOURS[c])}m: ${v}`} onPointerEnter={() => setHover({ r, c })} onPointerLeave={() => setHover(null)} className={`aspect-[1.4] rounded-[3px] ${hover?.r === r && hover?.c === c ? 'ring-2 ring-espresso' : ''}`} style={{ background: step(v) ?? 'var(--color-cream)' }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 text-xs text-bean">
        Quiet
        <span className="flex">{RAMP.map((c) => <span key={c} className="h-2.5 w-7 first:rounded-l-sm last:rounded-r-sm" style={{ background: c }} />)}</span>
        Busy
      </div>
    </div>
  )
}

// Ranked table with an inline bar on the main measure.
function RankTable({ rows, cols, barKey }) {
  const max = Math.max(1, ...rows.map((r) => num(r[barKey])))
  if (!rows.length) return <Empty>Nothing sold in this range.</Empty>
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="tabular w-full min-w-[36rem] text-left text-sm">
        <thead className="border-b border-parchment text-xs tracking-[0.08em] text-bean uppercase">
          <tr>
            <th className="py-2 pl-5 font-bold">#</th>
            {cols.map((c) => <th key={c.key} className={`py-2 font-bold ${c.num ? 'text-right' : ''} ${c.last ? 'pr-5' : 'pr-3'}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-parchment/60">
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className="transition-colors duration-150 hover:bg-cream">
              <td className="w-10 py-2.5 pl-5 text-bean">{i + 1}</td>
              {cols.map((c) => (
                <td key={c.key} className={`py-2.5 ${c.num ? 'text-right' : ''} ${c.last ? 'pr-5' : 'pr-3'}`}>
                  {c.key === barKey ? (
                    <span className="flex items-center justify-end gap-2">
                      <span className="hidden h-2 w-24 overflow-hidden rounded-full bg-cream sm:block" aria-hidden="true">
                        <span className="block h-full rounded-full" style={{ width: `${(num(r[barKey]) / max) * 100}%`, background: C.one }} />
                      </span>
                      <b className="font-bold">{c.fmt(r[c.key], r)}</b>
                    </span>
                  ) : c.fmt ? c.fmt(r[c.key], r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Tabs ----

// Net = gross profit − stock losses (spoilage, count shortages at cost). Deliveries aren't
// subtracted: goods and ingredients become cost when they sell (via each item's cost).
function Overview({ r }) {
  const t = r.totals
  const p = r.previous
  const st = r.stock
  const avg = t.receipts ? num(t.revenue) / t.receipts : 0
  const payTotal = r.payments.reduce((s, x) => s + num(x.total), 0)
  const net = num(t.gross_profit) - num(st.losses)
  const prevNet = num(p.gross_profit) - num(st.previous_losses)
  const room = num(r.rooms.revenue) / 100
  return (
    <>
      <div className="mt-6">
        <Kpis
          items={[
            { label: 'Cafe sales', value: num(t.revenue), fmt: money, note: <Delta now={num(t.revenue)} before={num(p.revenue)} fmt={money} /> },
            { label: 'Gross profit', value: num(t.gross_profit), fmt: money, note: `After food & goods cost · ${pct(num(t.gross_profit), num(t.revenue))} margin` },
            { label: net < 0 ? 'Net loss' : 'Net after waste', value: net, fmt: (v) => (v < 0 ? '−' + money(-v) : money(v)), tone: net < 0 ? 'text-tomato' : '', note: <Delta now={net} before={prevNet} fmt={money} /> },
            { label: 'Room revenue', value: room, fmt: money, note: `${plural(r.rooms.nights_sold, 'night')} sold · see Rooms` },
            { label: 'Receipts', value: t.receipts, note: <Delta now={t.receipts} before={p.receipts} /> },
            { label: 'Average order', value: avg, fmt: money, note: `${(t.receipts ? num(t.items) / t.receipts : 0).toFixed(1)} items per receipt` },
            { label: 'Discounts given', value: num(t.discounts), fmt: money, note: `${pct(num(t.discounts), num(t.revenue) + num(t.discounts))} of menu price` },
            { label: 'Voided', value: r.voids.count, note: r.voids.count ? `${money(r.voids.total)} reversed` : 'No voids' },
          ]}
        />
      </div>
      {num(t.revenue) > 0 && num(t.cost) === 0 && (
        <p className="mt-4 rounded-lg bg-honey/10 px-4 py-3 text-sm font-semibold text-honey">Profit equals sales because no item has a food cost yet. Add costs in Inventory › Edit to see real margins.</p>
      )}
      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel title="Sales over time" note="Each bar is the day’s sales, split into what it cost and the profit kept" className="xl:col-span-3">
          <SalesChart rows={r.daily} />
        </Panel>
        <Panel title="How customers paid" note={payTotal ? 'Share of sales by payment' : null} className="xl:col-span-2">
          <HBars rows={r.payments.map((x) => ({ name: `${METHOD[x.method] ?? x.method} · ${pct(num(x.total), payTotal)}`, value: num(x.total) }))} />
        </Panel>
        <Panel title="Busiest hours" note="Receipts by day and hour across the range" className="xl:col-span-3">
          <Heatmap hours={r.hours} />
        </Panel>
        <Panel title="Stock" note="From Inventory: deliveries, waste and counts" className="xl:col-span-2">
          <dl className="divide-y divide-parchment/70">
            {[
              ['Deliveries bought', num(st.purchases), 'Cash spent restocking. Not taken off profit: items count as cost when they sell.'],
              [num(st.losses) < 0 ? 'Stock found' : 'Waste and shortages', Math.abs(num(st.losses)), num(st.losses) < 0 ? 'Counts found more than recorded, at cost. Added back.' : 'Spoilage and count shortages, at cost. Taken off net.'],
            ].map(([k, v, note]) => (
              <div key={k} className="py-3 first:pt-0 last:pb-0">
                <dt className="text-sm font-semibold text-bean">{k}</dt>
                <dd className="tabular mt-1 font-display text-3xl leading-none font-semibold">{money(v)}</dd>
                <dd className="mt-1 text-xs text-bean">{note}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Sales by category" note="Before receipt discounts" className="xl:col-span-5">
          <HBars rows={r.categories.map((x) => ({ name: x.category, value: num(x.revenue) }))} />
        </Panel>
      </div>
    </>
  )
}

function MenuTab({ r }) {
  const [sort, setSort] = useState('revenue')
  const items = r.products
  const top = items[0]
  const units = items.reduce((s, x) => s + num(x.units), 0)
  const sorted = [...items].sort((a, b) => num(b[sort]) - num(a[sort]))
  const quiet = items.length ? [...items].sort((a, b) => num(a.units) - num(b.units))[0] : null
  return (
    <>
      <div className="mt-6">
        <Kpis
          items={[
            { label: 'Best seller', value: top ? top.name : '–', note: top ? `${money(top.revenue)} · ${top.units} sold` : 'No sales yet' },
            { label: 'Items sold', value: units, note: `${plural(items.length, 'different item')}` },
            { label: 'Top category', value: r.categories[0]?.category ?? '–', note: r.categories[0] ? money(r.categories[0].revenue) : 'No sales yet' },
            { label: 'Slowest seller', value: quiet ? quiet.name : '–', note: quiet ? `${quiet.units} sold in this range` : 'No sales yet' },
          ]}
        />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel
          title="Menu items"
          note="Ranked by the column you pick. Items that didn’t sell aren’t listed."
          className="xl:col-span-3"
          action={
            <div className="flex gap-1" role="group" aria-label="Sort by">
              {[['revenue', 'Sales'], ['units', 'Units'], ['profit', 'Profit']].map(([k, l]) => (
                <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={`press h-9 rounded-lg px-3 text-sm font-bold ${sort === k ? 'bg-espresso text-paper' : 'text-bean ring-1 ring-parchment hover:text-espresso'}`}>{l}</button>
              ))}
            </div>
          }
        >
          <RankTable
            rows={sorted.map((x) => ({ ...x, id: x.product_id }))}
            barKey={sort}
            cols={[
              { key: 'name', label: 'Item', fmt: (v, x) => <span><b className="font-bold">{v}</b> <span className="text-bean">· {x.category}</span></span> },
              { key: 'units', label: 'Units', num: true, fmt: (v) => num(v).toLocaleString('en-PH') },
              { key: 'revenue', label: 'Sales', num: true, fmt: money },
              { key: 'profit', label: 'Profit', num: true, fmt: money },
              { key: 'margin', label: 'Margin', num: true, last: true, fmt: (_, x) => pct(num(x.profit), num(x.revenue)) },
            ]}
          />
        </Panel>
        <Panel title="By category" note="Sales before discounts" className="xl:col-span-2">
          <HBars rows={r.categories.map((x) => ({ name: x.category, value: num(x.revenue) }))} />
        </Panel>
      </div>
    </>
  )
}

function StaffTab({ r }) {
  const staff = r.staff.map((s) => ({ ...s, id: s.staff_id, avg: s.receipts ? num(s.revenue) / s.receipts : 0 }))
  const top = staff[0]
  const disc = [...staff].sort((a, b) => num(b.discounts) - num(a.discounts))[0]
  return (
    <>
      <div className="mt-6">
        <Kpis
          items={[
            { label: 'On the register', value: staff.length, note: 'Made at least one sale' },
            { label: 'Top seller', value: top ? top.name : '–', note: top ? `${money(top.revenue)} · ${plural(top.receipts, 'receipt')}` : 'No sales yet' },
            { label: 'Most discounts', value: disc && num(disc.discounts) ? disc.name : '–', note: disc && num(disc.discounts) ? money(disc.discounts) : 'None given' },
            { label: 'Discounts given', value: num(r.totals.discounts), fmt: money, note: 'Across the team' },
          ]}
        />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel title="Sales by person" className="xl:col-span-2">
          <HBars rows={staff.map((s) => ({ name: s.name, value: num(s.revenue) }))} />
        </Panel>
        <Panel title="Leaderboard" note="Discounts are worth a look: they come straight off the till" className="xl:col-span-3">
          <RankTable
            rows={staff}
            barKey="revenue"
            cols={[
              { key: 'name', label: 'Person', fmt: (v, s) => <span><b className="font-bold">{v}</b> {s.role && s.role !== 'staff' && <span className="text-xs font-bold tracking-[0.08em] text-bean uppercase">{s.role}</span>}</span> },
              { key: 'receipts', label: 'Receipts', num: true },
              { key: 'revenue', label: 'Sales', num: true, fmt: money },
              { key: 'avg', label: 'Avg order', num: true, fmt: money },
              { key: 'discounts', label: 'Discounts', num: true, last: true, fmt: money },
            ]}
          />
        </Panel>
      </div>
    </>
  )
}

function RoomsTab({ r }) {
  const occ = r.nights_available ? r.nights_sold / r.nights_available : 0
  const rev = num(r.revenue) / 100
  const { unit, data } = bucketize(r.daily.map((d) => ({ ...d, revenue: num(d.revenue) / 100 })), ['occupied', 'revenue'])
  return (
    <>
      <div className="mt-6">
        <Kpis
          items={[
            { label: 'Occupancy', value: Math.round(occ * 100), fmt: (v) => `${Math.round(v)}%`, note: `${r.nights_sold} of ${plural(r.nights_available, 'room-night')}` },
            { label: 'Room revenue', value: rev, fmt: money, note: 'Spread over the nights stayed' },
            { label: 'Average nightly rate', value: r.nights_sold ? rev / r.nights_sold : 0, fmt: money, note: 'Room revenue ÷ nights sold' },
            { label: 'Bookings', value: num(r.bookings), note: r.cancelled ? `${plural(r.cancelled, 'cancellation')} too` : 'No cancellations' },
          ]}
        />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel title="Rooms taken" note={`Rooms occupied per ${unit} (out of ${r.rooms} each night)`} className="xl:col-span-3">
          {data.some((d) => d.occupied) ? (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap={data.length > 20 ? 2 : '20%'}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="label" {...axis} minTickGap={24} />
                  <YAxis {...axis} width={40} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'rgb(74 52 40 / 0.05)' }} content={<Tip fmt={(v) => plural(num(v), 'room-night')} />} />
                  <Bar dataKey="occupied" name="Taken" fill={C.one} radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty>No nights booked in this range.</Empty>
          )}
        </Panel>
        <Panel title="By room" note="Nights sold" className="xl:col-span-2">
          <HBars rows={r.by_room.map((x) => ({ name: x.name, value: num(x.nights) }))} fmt={(v) => plural(num(v), 'night')} />
        </Panel>
        <Panel title="Room revenue by room" className="xl:col-span-3">
          <HBars rows={r.by_room.map((x) => ({ name: x.name, value: num(x.revenue) / 100 }))} />
        </Panel>
        <Panel title="Where bookings came from" note="Stays starting in this range" className="xl:col-span-2">
          <HBars rows={r.by_source.map((x) => ({ name: { web: 'Website', walk_in: 'Walk-in', phone: 'Phone', facebook: 'Facebook', other: 'Other' }[x.source] ?? x.source, value: num(x.bookings) }))} fmt={(v) => plural(num(v), 'booking')} />
        </Panel>
      </div>
      <p className="mt-4 text-xs text-bean">Counts confirmed, in-house and checked-out stays. Website holds and cancellations aren’t counted.</p>
    </>
  )
}
