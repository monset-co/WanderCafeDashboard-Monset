import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Ban, Loader2, Package, Search } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { METHOD, ORDER_TYPE, ORDER_TYPES, addDays, fmtDateTime, manilaMidnight, money, plural, receiptNo } from '../lib/util.js'
import { BTN, Badge, CARD, EASE_OUT, Empty, FIELD, Kpis, LABEL, PageHeader, Problem, RangePicker, Sheet, SkeletonRows, Submit, presets } from '../components/ui.jsx'
import { useAuth } from '../auth.jsx'

const PAGE = 50
const SELECT = 'h-11 rounded-lg bg-paper px-3 text-sm font-semibold ring-1 ring-parchment outline-none focus:ring-2 focus:ring-teal-deep disabled:opacity-50'
const COLS = 'id, sale_no, sold_at, order_type, order_status, payment_method, payment_ref, subtotal, discount, total, amount_tendered, change_due, customer_name, note, status, voided_at, voided_by, void_reason, staff_id, sale_items(product_name, qty, unit_price, line_total)'

export default function Sales() {
  const { isManager } = useAuth() // staff only ever receive their own receipts (sales read policy)
  const opts = useMemo(presets, [])
  const [range, setRange] = useState({ key: 'today', from: opts[0][2], to: opts[0][3] })
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [itemTyped, setItemTyped] = useState('')
  const [item, setItem] = useState('')
  const [method, setMethod] = useState('')
  const [otype, setOtype] = useState('')
  const [status, setStatus] = useState('')
  const [staff, setStaff] = useState('')
  const [people, setPeople] = useState([])
  const [rows, setRows] = useState(null)
  const [count, setCount] = useState(0)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState(null)
  const req = useRef(0)

  useEffect(() => {
    supabase.from('profiles').select('id, full_name').order('full_name').then(({ data }) => setPeople(data ?? []))
  }, [])
  // Debounce typing so every keystroke isn't a query.
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed.trim().replace(/^#/, '')), 300)
    return () => clearTimeout(t)
  }, [typed])
  useEffect(() => {
    const t = setTimeout(() => setItem(itemTyped.trim()), 300)
    return () => clearTimeout(t)
  }, [itemTyped])

  const byReceipt = /^\d+$/.test(search)
  const query = useCallback(
    (offset) => {
      let q = supabase
        .from('sales')
        .select(COLS + (item ? ', hit:sale_items!inner(product_name)' : ''), { count: 'exact' })
        .order('sold_at', { ascending: false })
        .range(offset, offset + PAGE - 1)
      if (byReceipt) return q.eq('sale_no', Number(search)) // a receipt number finds it on any date
      q = q.gte('sold_at', manilaMidnight(range.from)).lt('sold_at', manilaMidnight(addDays(range.to, 1)))
      if (search) q = q.ilike('customer_name', `%${search}%`)
      if (method) q = q.eq('payment_method', method)
      if (otype) q = q.eq('order_type', otype)
      if (status) q = q.eq('status', status)
      if (staff) q = q.eq('staff_id', staff)
      if (item) q = q.ilike('hit.product_name', `%${item}%`)
      return q
    },
    [range.from, range.to, search, byReceipt, method, otype, status, staff, item],
  )

  const reload = useCallback(async () => {
    const id = ++req.current
    setBusy(true)
    const [list, rep] = await Promise.all([query(0), isManager ? supabase.rpc('sales_report', { p_from: range.from, p_to: range.to }) : { error: true }])
    if (id !== req.current) return // a newer filter won
    setBusy(false)
    if (list.error) return setError(list.error.message)
    setError(null)
    setRows(list.data)
    setCount(list.count ?? list.data.length)
    if (!rep.error) setSummary(rep.data)
  }, [query, range.from, range.to, isManager])
  useEffect(() => {
    reload()
  }, [reload])
  // Live: a sale rung up or voided anywhere shows here. Debounced: one checkout fires an insert and an update.
  useEffect(() => {
    let t
    const ch = supabase
      .channel('sales-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
        clearTimeout(t)
        t = setTimeout(reload, 500)
      })
      .subscribe()
    return () => {
      clearTimeout(t)
      supabase.removeChannel(ch)
    }
  }, [reload])

  const more = async () => {
    setBusy(true)
    const { data, error } = await query(rows.length)
    setBusy(false)
    if (error) return setError(error.message)
    setRows((r) => [...r, ...data])
  }

  const names = Object.fromEntries(people.map((p) => [p.id, p.full_name]))
  const open = rows?.find((r) => r.id === openId)
  const pay = (keys) => (summary?.payments ?? []).filter((p) => keys.includes(p.method)).reduce((s, p) => s + Number(p.total), 0)
  const filtered = method || otype || status || staff || search || item

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader title="Sales" sub={isManager ? 'Every receipt, who rang it up and how it was paid. Open one to void it.' : 'Receipts you rang up.'}>
        <RangePicker opts={opts} range={range} setRange={setRange} />
      </PageHeader>

      {isManager && (
        <div className="mt-6">
          <Kpis
            items={[
              { label: 'Sales', value: summary && Number(summary.totals.revenue), fmt: money, note: summary && plural(summary.totals.receipts, 'receipt') },
              { label: 'Cash', value: summary && pay(['cash']), fmt: money, note: 'Should be in the drawer' },
              { label: 'GCash + Maya', value: summary && pay(['gcash', 'maya']), fmt: money, note: 'E-wallets' },
              { label: 'Card + bank', value: summary && pay(['card', 'bank_transfer']), fmt: money, note: 'Check the statements' },
              { label: 'Discounts', value: summary && Number(summary.totals.discounts), fmt: money, note: 'Taken off at the till' },
              { label: 'Voided', value: summary && summary.voids.count, note: summary && (summary.voids.count ? `${money(summary.voids.total)} reversed` : 'None') },
            ]}
          />
          {filtered && <p className="mt-2 text-xs text-bean">The totals cover the whole date range; the filters below only narrow the list.</p>}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center">
        <label className="relative block xl:w-64">
          <span className="sr-only">Search receipt number or customer</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-bean" aria-hidden="true" />
          <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Receipt # or name / table" className={`${FIELD} pl-10`} />
        </label>
        <label className="relative block xl:w-56">
          <span className="sr-only">Item</span>
          <Package className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-bean" aria-hidden="true" />
          <input type="search" value={itemTyped} onChange={(e) => setItemTyped(e.target.value)} disabled={byReceipt} placeholder="Item, e.g. Latte" className={`${FIELD} pl-10`} />
        </label>
        <div className={`grid gap-2 ${isManager ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} xl:flex`}>
          <label>
            <span className="sr-only">Order type</span>
            <select value={otype} onChange={(e) => setOtype(e.target.value)} disabled={byReceipt} className={`${SELECT} w-full`}>
              <option value="">All orders</option>
              {ORDER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Payment method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={byReceipt} className={`${SELECT} w-full`}>
              <option value="">All payments</option>
              {Object.entries(METHOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {isManager && (
            <label>
              <span className="sr-only">Staff</span>
              <select value={staff} onChange={(e) => setStaff(e.target.value)} disabled={byReceipt} className={`${SELECT} w-full`}>
                <option value="">All staff</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </label>
          )}
          <label>
            <span className="sr-only">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={byReceipt} className={`${SELECT} w-full`}>
              <option value="">All receipts</option>
              <option value="completed">Completed</option>
              <option value="voided">Voided</option>
            </select>
          </label>
        </div>
        <p className="tabular text-sm text-bean xl:ml-auto" aria-live="polite">
          {busy ? <Loader2 className="inline size-4 animate-spin" aria-label="Loading" /> : rows && `${plural(count, 'receipt')}${byReceipt ? ' with that number, any date' : ''}`}
        </p>
      </div>

      {error && <div className="mt-4"><Problem onRetry={reload}>Couldn't load sales. {error}</Problem></div>}

      <div className={`${CARD} mt-4 overflow-hidden transition-opacity duration-200 ${busy && rows ? 'opacity-60' : ''}`}>
        {!rows && !error && <SkeletonRows label="Loading sales" />}
        {rows && rows.length === 0 && <Empty>{filtered ? 'No receipts match these filters.' : 'No sales in this range yet. They show up here the moment they’re rung up.'}</Empty>}
        {rows && rows.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-parchment text-xs font-bold tracking-[0.08em] text-bean uppercase max-md:sr-only">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">Receipt</th>
                <th scope="col" className="px-3 py-3 font-bold">Items</th>
                <th scope="col" className="px-3 py-3 font-bold">Rang up by</th>
                <th scope="col" className="px-3 py-3 font-bold">Paid</th>
                <th scope="col" className="px-5 py-3 text-right font-bold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment/60">
              {rows.map((r) => <SaleRow key={r.id} r={r} who={names[r.staff_id]} onOpen={() => setOpenId(r.id)} />)}
            </tbody>
          </table>
        )}
      </div>
      {rows && rows.length < count && (
        <button type="button" onClick={more} disabled={busy} className={`${BTN.quiet} mx-auto mt-4 flex`}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Show more ({count - rows.length} left)
        </button>
      )}

      <AnimatePresence>{open && <ReceiptSheet key="sheet" r={open} names={names} canVoid={isManager} onClose={() => setOpenId(null)} onVoided={reload} />}</AnimatePresence>
    </main>
  )
}

const itemsSummary = (items) => {
  const first = items.slice(0, 2).map((i) => `${i.qty}× ${i.product_name}`).join(', ')
  return items.length > 2 ? `${first} +${items.length - 2} more` : first
}

function SaleRow({ r, who, onOpen }) {
  const voided = r.status === 'voided'
  return (
    <tr onClick={onOpen} className="group cursor-pointer transition-colors duration-150 hover:bg-cream max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:px-4 max-md:py-3">
      <td className="px-5 py-3 max-md:p-0">
        <button type="button" onClick={(e) => (e.stopPropagation(), onOpen())} className="text-left">
          <span className="tabular font-bold group-hover:underline group-hover:decoration-teal group-hover:decoration-2 group-hover:underline-offset-4">{receiptNo(r.sale_no)}</span>
          <span className="tabular block text-xs text-bean">{fmtDateTime(r.sold_at)} · {ORDER_TYPE[r.order_type] ?? 'Dine-in'}{r.customer_name && ` · ${r.customer_name}`}</span>
        </button>
      </td>
      <td className={`px-3 py-3 max-md:order-3 max-md:col-span-2 max-md:p-0 max-md:pt-1 ${voided ? 'text-bean' : ''}`}>{itemsSummary(r.sale_items)}</td>
      <td className="px-3 py-3 text-bean max-md:hidden">{who ?? 'Unknown'}</td>
      <td className="px-3 py-3 max-md:hidden">
        {METHOD[r.payment_method]}
        {r.payment_ref && <span className="tabular block text-xs text-bean">ref …{r.payment_ref}</span>}
      </td>
      <td className="px-5 py-3 text-right max-md:p-0">
        <span className="flex flex-col items-end gap-1">
          <span className={`tabular text-lg font-bold ${voided ? 'text-bean line-through decoration-2' : ''}`}>{money(r.total)}</span>
          {voided && <Badge tone="bad" Icon={Ban}>Voided</Badge>}
        </span>
      </td>
    </tr>
  )
}

function ReceiptSheet({ r, names, canVoid, onClose, onVoided }) {
  const voided = r.status === 'voided'
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const voidSale = async (e) => {
    e.preventDefault()
    if (!reason.trim()) return setErr('Say why, e.g. wrong order or the customer changed their mind.')
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('void_sale', { p_sale_id: r.id, p_reason: reason.trim() })
    setBusy(false)
    if (error) return setErr(error.message)
    onVoided()
  }

  return (
    <Sheet title={`Receipt ${receiptNo(r.sale_no)}`} subtitle={`${fmtDateTime(r.sold_at)} · ${names[r.staff_id] ?? 'Unknown'}`} onClose={onClose}>
      <AnimatePresence initial={false}>
        {voided && (
          <motion.div role="status" className="mb-4 rounded-xl bg-tomato/8 p-4 text-sm ring-1 ring-tomato/20" initial={{ opacity: 0, transform: 'translateY(-6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.2, ease: EASE_OUT }}>
            <Badge tone="bad" Icon={Ban}>Voided</Badge>
            <p className="mt-2 font-semibold">“{r.void_reason}”</p>
            <p className="text-bean">{fmtDateTime(r.voided_at)} by {names[r.voided_by] ?? 'a manager'}. Stock went back and it’s left out of totals.</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`${CARD} p-5`}>
        <ul className="tabular space-y-2 text-sm">
          {r.sale_items.map((i, k) => (
            <li key={k} className="flex justify-between gap-3">
              <span><span className="text-bean">{i.qty} ×</span> {i.product_name} <span className="text-bean">@ {money(i.unit_price)}</span></span>
              <span>{money(i.line_total)}</span>
            </li>
          ))}
        </ul>
        <dl className="tabular mt-4 space-y-1.5 border-t border-dashed border-parchment pt-3 text-sm">
          {Number(r.discount) > 0 && (
            <>
              <Line k="Subtotal" v={money(r.subtotal)} />
              <Line k="Discount" v={`−${money(r.discount)}`} />
            </>
          )}
          <div className="flex items-end justify-between pt-1">
            <dt className="font-bold">Total</dt>
            <dd className={`font-display text-4xl leading-none font-semibold ${voided ? 'text-bean line-through decoration-2' : ''}`}>{money(r.total)}</dd>
          </div>
          <Line k="Order" v={`${ORDER_TYPE[r.order_type] ?? 'Dine-in'} · ${r.order_status === 'preparing' ? 'still preparing' : 'completed'}`} />
          <Line k="Paid by" v={METHOD[r.payment_method]} />
          {r.payment_ref && <Line k="GCash ref (last 4)" v={r.payment_ref} />}
          {r.amount_tendered != null && (
            <>
              <Line k="Cash received" v={money(r.amount_tendered)} />
              <Line k="Change given" v={money(r.change_due ?? 0)} />
            </>
          )}
          {r.customer_name && <Line k="Name / table" v={r.customer_name} />}
          {r.note && <Line k="Kitchen note" v={r.note} />}
        </dl>
      </div>

      {canVoid && !voided && (
        <form onSubmit={voidSale} className="mt-6 space-y-3 rounded-xl p-5 ring-1 ring-tomato/30">
          <h3 className="text-lg font-bold">Void this sale</h3>
          <p className="text-sm text-bean">For a mistake or a refund. Bottled goods go back into stock and the sale drops out of totals. The receipt stays here, marked voided. This can’t be undone.</p>
          <label className={LABEL}>
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong order, refund, rang up twice…" className={`${FIELD} mt-1.5`} />
          </label>
          {err && <Problem>{err}</Problem>}
          <Submit busy={busy} tone="danger">
            {!busy && <Ban className="size-5" aria-hidden="true" />} Void {money(r.total)}
          </Submit>
        </form>
      )}
    </Sheet>
  )
}

function Line({ k, v }) {
  return (
    <div className="flex justify-between gap-3 text-bean">
      <dt>{k}</dt>
      <dd className="text-right text-espresso">{v}</dd>
    </div>
  )
}
