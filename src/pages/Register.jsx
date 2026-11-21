import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleCheck, Loader2, Minus, NotebookPen, Plus, Search, ShoppingBag, Tag, UserRound, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { METHODS, METHOD, fmtDateTime, manilaMidnight, manilaToday, money, moneyInput, receiptNo, round2, uuid } from '../lib/util.js'
import { Chips, CountUp, EASE_OUT, Problem } from '../components/ui.jsx'
import { useAuth } from '../auth.jsx'

// Stock wording, shared with Inventory. Always words, never colour alone.
export const stockOf = (p) =>
  p.kind === 'made'
    ? null
    : p.stock_qty <= 0
      ? { key: 'out', label: 'Out of stock', tone: 'text-tomato' }
      : p.stock_qty <= p.reorder_level
        ? { key: 'low', label: `Low · ${+p.stock_qty} left`, tone: 'text-honey' }
        : { key: 'ok', label: `${+p.stock_qty} in stock`, tone: 'text-bean' }

export default function Register() {
  const { isManager, profile } = useAuth()
  const [products, setProducts] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [today, setToday] = useState(null)
  const [cat, setCat] = useState('All')
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([]) // [{ id, qty }] in the order added
  const [method, setMethod] = useState('cash')
  const [tendered, setTendered] = useState('')
  const [gcashRef, setGcashRef] = useState('')
  const [discount, setDiscount] = useState('')
  const [customer, setCustomer] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [sheet, setSheet] = useState(false)
  const clientRef = useRef(uuid()) // reused on retries so a dropped connection never records the sale twice
  const searchRef = useRef(null)

  const load = useCallback(async () => {
    const t = manilaToday()
    const [p, s] = await Promise.all([
      supabase.from('products').select('*').eq('is_active', true).neq('kind', 'supply').order('category').order('sort').order('name'),
      // Today's takings: managers see the whole till, staff see their own (the sales policy decides).
      supabase.from('sales').select('total').eq('status', 'completed').gte('sold_at', manilaMidnight(t)),
    ])
    if (p.error) setLoadError(p.error.message)
    else {
      setLoadError(null)
      setProducts(p.data)
    }
    if (!s.error) setToday({ receipts: s.data.length, revenue: s.data.reduce((a, r) => a + Number(r.total), 0) })
  }, [])
  useEffect(() => {
    load()
  }, [load])

  // Keep search focused for a barcode scanner, but not on touch screens where it pops the keyboard.
  const focusSearch = () => matchMedia('(pointer: fine)').matches && searchRef.current?.focus()
  useEffect(() => {
    focusSearch()
  }, [])

  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])
  const categories = useMemo(() => ['All', ...new Set((products ?? []).map((p) => p.category))], [products])
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = new Map()
    for (const p of products ?? []) {
      if ((cat !== 'All' && p.category !== cat) || (q && !p.name.toLowerCase().includes(q) && !p.code.toLowerCase().includes(q))) continue
      out.set(p.category, [...(out.get(p.category) ?? []), p])
    }
    return [...out]
  }, [products, cat, query])
  const shown = groups.flatMap(([, ps]) => ps)

  const lines = cart.filter((l) => byId.has(l.id)).map((l) => ({ ...byId.get(l.id), qty: l.qty }))
  const qtyIn = (id) => cart.find((l) => l.id === id)?.qty ?? 0
  const count = lines.reduce((n, l) => n + l.qty, 0)
  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.selling_price, 0))
  const disc = round2(Number(discount) || 0)
  const discTooBig = disc > subtotal
  const total = round2(Math.max(subtotal - disc, 0))
  const paid = method === 'cash' ? (tendered === '' ? total : Number(tendered)) : null // blank = exact amount
  const change = paid == null ? null : round2(paid - total)
  const refMissing = method === 'gcash' && !/^\d{4}$/.test(gcashRef)
  const canCharge = lines.length > 0 && !busy && !discTooBig && !refMissing && (change == null || change >= 0)

  const maxQty = (p) => (p.kind === 'good' ? Math.floor(p.stock_qty) : Infinity)
  const add = (p) => {
    if (qtyIn(p.id) >= maxQty(p)) return
    setError(null)
    setCart((c) => (c.some((l) => l.id === p.id) ? c.map((l) => (l.id === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { id: p.id, qty: 1 }]))
  }
  const setQty = (p, qty) => {
    setError(null)
    setCart((c) => (qty <= 0 ? c.filter((l) => l.id !== p.id) : c.map((l) => (l.id === p.id ? { ...l, qty: Math.min(qty, maxQty(p)) } : l))))
  }
  // Enter in search adds an exact code match (scanners type the code + Enter) or the only result.
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return
    const q = query.trim().toLowerCase()
    const hit = shown.find((p) => p.code.toLowerCase() === q) ?? (shown.length === 1 ? shown[0] : null)
    if (hit) {
      add(hit)
      setQuery('')
    }
  }

  const reset = () => {
    clientRef.current = uuid()
    setCart([])
    setTendered('')
    setGcashRef('')
    setDiscount('')
    setCustomer('')
    setNote('')
    setMethod('cash')
    setSheet(false)
  }

  const charge = async () => {
    if (!canCharge) return
    setBusy(true)
    setError(null)
    const { data: id, error } = await supabase.rpc('record_sale', {
      p_items: lines.map((l) => ({ product_id: l.id, qty: l.qty })),
      p_payment_method: method,
      p_discount: disc,
      p_amount_tendered: paid,
      p_customer_name: customer.trim() || null,
      p_note: note.trim() || null,
      p_client_ref: clientRef.current,
      p_payment_ref: method === 'gcash' ? gcashRef : null,
    })
    if (error) {
      setBusy(false)
      setError(/fetch|network/i.test(error.message) ? "Connection problem. Tap Charge again: it won't be recorded twice." : error.message)
      load()
      return
    }
    const { data: sale } = await supabase
      .from('sales')
      .select('sale_no, sold_at, subtotal, discount, total, note, amount_tendered, change_due, payment_method, payment_ref, customer_name, sale_items(product_name, qty, line_total)')
      .eq('id', id)
      .single()
    // The sale is saved either way; fall back to what the register knows if the read-back failed.
    setReceipt(
      sale ?? {
        sale_no: null, sold_at: new Date().toISOString(), subtotal, discount: disc, total, note: note.trim() || null,
        amount_tendered: paid, change_due: change, payment_method: method, payment_ref: method === 'gcash' ? gcashRef : null,
        customer_name: customer.trim() || null, sale_items: lines.map((l) => ({ product_name: l.name, qty: l.qty, line_total: l.qty * l.selling_price })),
      },
    )
    reset()
    setBusy(false)
    load()
  }

  const newSale = useCallback(() => {
    setReceipt(null)
    focusSearch()
  }, [])

  return (
    <>
      <div className="lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section className="min-w-0 px-4 pt-5 pb-28 sm:px-6 lg:overflow-y-auto lg:pb-10">
          <h1 className="sr-only">Register</h1>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label className="relative block md:w-64 md:shrink-0">
              <span className="sr-only">Search the menu or scan a code</span>
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-bean" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search or type a code"
                className="h-11 w-full rounded-full bg-paper pr-3 pl-10 ring-1 ring-parchment outline-none placeholder:text-bean/70 focus:ring-2 focus:ring-teal-deep"
              />
            </label>
            <Chips id="reg-cat" label="Category" value={cat} onChange={setCat} options={categories.map((c) => [c, c])} />
            {today && (
              <p className="tabular shrink-0 text-sm text-bean md:ml-auto md:text-right" title={isManager ? 'Everyone’s sales today' : 'Your sales today'}>
                {isManager ? 'Today' : 'Your sales today'} <b className="font-bold text-espresso"><CountUp value={today.revenue} format={money} /></b> · <CountUp value={today.receipts} /> receipt{today.receipts === 1 ? '' : 's'}
              </p>
            )}
          </div>

          {loadError && (
            <div className="mt-6">
              <Problem onRetry={load}>Couldn't load the menu. {loadError}</Problem>
            </div>
          )}
          {!products && !loadError && <SkeletonGrid />}
          {products && shown.length === 0 && (
            <p className="mt-16 text-center text-bean">{products.length === 0 ? 'Nothing on the menu yet. A manager can add items in Inventory.' : `Nothing matches “${query}”.`}</p>
          )}

          {/* Keyed on the filter so switching category cross-fades instead of popping. */}
          <div key={cat} className="fade-in">
            {groups.map(([category, ps]) => (
              <section key={category} aria-labelledby={`cat-${category}`} className="mt-7 first:mt-6">
                <h2 id={`cat-${category}`} className="flex items-baseline gap-2 font-display text-xl font-semibold tracking-[-0.01em]">
                  {category} <span className="tabular font-sans text-sm font-semibold text-bean/70">{ps.length}</span>
                </h2>
                <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {ps.map((p) => (
                    <li key={p.id}>
                      <ProductTile p={p} inCart={qtyIn(p.id)} onAdd={() => add(p)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>

        <aside aria-label="Current order" className={`bg-roast text-paper lg:flex lg:min-h-0 lg:flex-col lg:overflow-y-auto ${sheet ? 'sheet-in fixed inset-0 z-40 flex flex-col overflow-y-auto' : 'max-lg:hidden'}`}>
          <Cart
            {...{ lines, count, subtotal, total, method, setMethod, tendered, setTendered, gcashRef, setGcashRef, discount, setDiscount, discTooBig, customer, setCustomer, note, setNote, change, busy, error, canCharge, charge, setQty }}
            onClear={() => setCart([])}
            onClose={() => setSheet(false)}
          />
        </aside>
      </div>

      {/* Phones and small tablets: the order lives in a sheet behind this bar. */}
      <AnimatePresence>
        {count > 0 && !sheet && (
          <motion.button
            type="button"
            onClick={() => setSheet(true)}
            className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex h-16 items-center justify-between rounded-2xl bg-roast px-5 text-paper shadow-[0_14px_36px_-10px_rgb(51_36_28/0.7)] lg:hidden"
            initial={{ transform: 'translateY(130%)' }}
            animate={{ transform: 'translateY(0%)' }}
            exit={{ transform: 'translateY(130%)', transition: { duration: 0.18 } }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
          >
            <span className="flex items-center gap-2 font-semibold">
              <ShoppingBag className="size-5 text-tiffany" aria-hidden="true" /> {count} item{count === 1 ? '' : 's'}
            </span>
            <span className="tabular font-display text-2xl font-semibold">Review {money(total)}</span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>{receipt && <Receipt sale={receipt} cashier={profile?.full_name} onDone={newSale} />}</AnimatePresence>
    </>
  )
}

function SkeletonGrid() {
  return (
    <div className="mt-6" aria-label="Loading the menu" role="status">
      <div className="skeleton h-5 w-36 rounded" />
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, k) => (
          <div key={k} className="skeleton h-28 rounded-xl" style={{ animationDelay: `${k * 60}ms` }} />
        ))}
      </div>
    </div>
  )
}

function ProductTile({ p, inCart, onAdd }) {
  const s = stockOf(p)
  const soldOut = p.kind === 'good' && inCart >= Math.floor(p.stock_qty)
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={soldOut}
      aria-label={`Add ${p.name}, ${money(p.selling_price)}${s ? `, ${s.label}` : ''}${inCart ? `, ${inCart} in order` : ''}`}
      className={`press relative flex h-full min-h-28 w-full flex-col rounded-xl bg-paper p-3.5 text-left ring-1 transition-[box-shadow,opacity,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${inCart ? 'ring-2 ring-teal-deep' : 'ring-parchment hover:ring-bean/40'}`}
    >
      <span className="leading-snug font-semibold text-pretty">{p.name}</span>
      <span className="tabular mt-auto pt-3 text-xl leading-none font-bold">{money(p.selling_price)}</span>
      {s && <span className={`mt-1.5 text-xs font-bold ${s.tone}`}>{s.label}</span>}
      <AnimatePresence>
        {inCart > 0 && (
          <motion.span
            aria-hidden="true"
            className="tabular absolute -top-2 -right-2 grid size-7 place-items-center rounded-full bg-teal-deep text-sm font-bold text-paper shadow-[0_4px_10px_-2px_rgb(47_98_94/0.5)]"
            initial={{ opacity: 0, transform: 'scale(0.6)' }}
            animate={{ opacity: 1, transform: 'scale(1)' }}
            exit={{ opacity: 0, transform: 'scale(0.6)', transition: { duration: 0.12 } }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.25 }}
          >
            {/* Remounts per count so each tap gets a small bump. */}
            <motion.span key={inCart} initial={{ transform: 'scale(1.3)' }} animate={{ transform: 'scale(1)' }} transition={{ type: 'spring', duration: 0.25, bounce: 0.35 }}>
              {inCart}
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

const darkField = 'h-11 w-full rounded-lg bg-roast-2 px-3 text-paper ring-1 ring-paper/10 outline-none transition-shadow duration-150 placeholder:text-foam/60 focus:ring-2 focus:ring-tiffany'
const chip = 'press flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ring-1 ring-paper/15 text-foam hover:text-paper'

function Cart({ lines, count, subtotal, total, method, setMethod, tendered, setTendered, gcashRef, setGcashRef, discount, setDiscount, discTooBig, customer, setCustomer, note, setNote, change, busy, error, canCharge, charge, setQty, onClear, onClose }) {
  const [open, setOpen] = useState({}) // which optional fields are showing
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  useEffect(() => {
    if (!lines.length && !discount && !customer && !note) setOpen({})
  }, [lines.length, discount, customer, note])
  const quick = [...new Set([100, 200, 500, 1000].map((b) => Math.ceil(total / b) * b))].filter((v) => v > total).slice(0, 3)

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-5 pb-3 short:pt-3 short:pb-1">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.01em]">
          Order {count > 0 && <span className="tabular text-foam">· {count}</span>}
        </h2>
        <div className="flex items-center gap-2">
          {lines.length > 0 && (
            <button type="button" onClick={onClear} className="press rounded-lg px-2.5 py-1.5 text-sm font-semibold text-foam hover:text-paper">
              Clear
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Back to the menu" className="press grid size-10 place-items-center rounded-lg ring-1 ring-paper/15 lg:hidden">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <ul className="min-h-32 flex-1 overflow-y-auto px-5 short:min-h-16">
        {!lines.length && <li className="grid h-32 place-items-center text-center text-sm text-foam">Tap an item to start an order.</li>}
        <AnimatePresence initial={false}>
          {lines.map((l) => (
            <motion.li
              key={l.id}
              layout="position"
              initial={{ opacity: 0, transform: 'translateX(14px)' }}
              animate={{ opacity: 1, transform: 'translateX(0px)' }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="flex items-center gap-3 border-b border-paper/10 py-3 short:py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{l.name}</p>
                <p className="tabular text-xs text-foam">{money(l.selling_price)} each</p>
              </div>
              <div className="flex items-center rounded-full bg-roast-2 ring-1 ring-paper/10">
                <button type="button" onClick={() => setQty(l, l.qty - 1)} aria-label={`One less ${l.name}`} className="press grid size-9 place-items-center rounded-full text-foam hover:text-paper">
                  <Minus className="size-4" aria-hidden="true" />
                </button>
                <span className="tabular w-7 text-center font-bold" aria-live="polite">{l.qty}</span>
                <button type="button" onClick={() => setQty(l, l.qty + 1)} disabled={l.kind === 'good' && l.qty >= Math.floor(l.stock_qty)} aria-label={`One more ${l.name}`} className="press grid size-9 place-items-center rounded-full text-foam hover:text-paper disabled:opacity-30">
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
              <span className="tabular w-16 text-right font-bold">{money(l.qty * l.selling_price)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <div className="shrink-0 space-y-4 border-t border-paper/10 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] short:space-y-2.5 short:pt-2.5">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => toggle('customer')} aria-expanded={!!open.customer || !!customer} className={chip}>
            <UserRound className="size-4" aria-hidden="true" /> {customer ? customer : 'Name / table'}
          </button>
          <button type="button" onClick={() => toggle('note')} aria-expanded={!!open.note || !!note} className={chip}>
            <NotebookPen className="size-4" aria-hidden="true" /> {note ? 'Note added' : 'Kitchen note'}
          </button>
          <button type="button" onClick={() => toggle('discount')} aria-expanded={!!open.discount || !!discount} className={chip}>
            <Tag className="size-4" aria-hidden="true" /> {discount ? `−${money(discount)}` : 'Discount'}
          </button>
        </div>
        {(open.customer || customer) && (
          <label className="block">
            <span className="sr-only">Customer name or table</span>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Name or table, e.g. Table 4" className={darkField} />
          </label>
        )}
        {(open.note || note) && (
          <label className="block">
            <span className="sr-only">Kitchen note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Spicy, waffle base, no ice…" className={darkField} />
          </label>
        )}
        {(open.discount || discount) && (
          <label className="block">
            <span className="sr-only">Discount in pesos</span>
            <input inputMode="decimal" value={discount} onChange={moneyInput(setDiscount)} placeholder="Discount in ₱ (senior/PWD, promo…)" className={darkField} />
            {discTooBig && <span className="mt-1 block text-xs font-semibold text-[#f2a08f]">The discount is more than the order.</span>}
          </label>
        )}

        <div role="radiogroup" aria-label="Payment" className="grid grid-cols-3 gap-1.5">
          {METHODS.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={method === v} onClick={() => setMethod(v)} className={`press relative h-10 rounded-lg text-sm font-bold ${method === v ? 'text-roast' : 'text-foam ring-1 ring-paper/15 hover:text-paper'}`}>
              {method === v && <motion.span layoutId="pay-pill" className="absolute inset-0 rounded-lg bg-tiffany" transition={{ type: 'spring', duration: 0.3, bounce: 0 }} />}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>

        {method === 'cash' && lines.length > 0 && (
          <div>
            <label className="block text-sm font-semibold text-foam">
              Cash received <span className="font-normal">(blank = exact)</span>
              <input inputMode="decimal" value={tendered} onChange={moneyInput(setTendered)} placeholder={money(total)} className={`${darkField} tabular mt-1.5`} />
            </label>
            <div className="mt-2 flex gap-1.5">
              {quick.map((v) => (
                <button key={v} type="button" onClick={() => setTendered(String(v))} className={`${chip} tabular`}>
                  {money(v)}
                </button>
              ))}
            </div>
          </div>
        )}
        {method === 'gcash' && (
          <label className="block text-sm font-semibold text-foam">
            GCash reference, last 4 digits
            <input inputMode="numeric" maxLength={4} value={gcashRef} onChange={(e) => /^\d{0,4}$/.test(e.target.value) && setGcashRef(e.target.value)} placeholder="0000" className={`${darkField} tabular mt-1.5 tracking-[0.3em]`} />
          </label>
        )}

        <dl className="tabular space-y-1 text-sm">
          {Number(discount) > 0 && (
            <>
              <div className="flex justify-between text-foam"><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div>
              <div className="flex justify-between text-foam"><dt>Discount</dt><dd>−{money(discount)}</dd></div>
            </>
          )}
          <div className="flex items-end justify-between pt-1">
            <dt className="text-lg font-bold">Total</dt>
            <dd className="font-display text-4xl leading-none font-semibold tracking-[-0.02em]"><CountUp value={total} format={money} duration={0.25} /></dd>
          </div>
          {change != null && lines.length > 0 && (
            <div className={`flex justify-between font-semibold ${change < 0 ? 'text-[#f2a08f]' : 'text-tiffany'}`}>
              <dt>{change < 0 ? 'Short by' : 'Change'}</dt>
              <dd>{money(Math.abs(change))}</dd>
            </div>
          )}
        </dl>

        {error && <p role="alert" className="rounded-lg bg-tomato/25 px-3 py-2.5 text-sm font-semibold text-paper ring-1 ring-tomato/60">{error}</p>}

        <button type="button" onClick={charge} disabled={!canCharge} className="press flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-tiffany text-lg font-extrabold text-roast hover:bg-[#95e0d9] disabled:opacity-35">
          {busy && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
          {busy ? 'Recording' : lines.length ? `Charge ${money(total)}` : 'Charge'}
        </button>
        {refMissing && lines.length > 0 && <p className="-mt-2 text-center text-xs text-foam">Enter the GCash reference to charge.</p>}
      </div>
    </>
  )
}

// On-screen receipt after a sale. Enter or the button starts the next order.
function Receipt({ sale, cashier, onDone }) {
  useEffect(() => {
    const onKey = (e) => (e.key === 'Enter' || e.key === 'Escape') && onDone()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-roast/50 px-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-title"
        className="w-full max-w-sm rounded-2xl bg-paper p-6 shadow-[0_30px_80px_-24px_rgb(51_36_28/0.7)]"
        initial={{ opacity: 0, transform: 'translateY(12px) scale(0.97)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
      >
        <div className="flex items-center gap-3">
          <CircleCheck className="size-8 text-leaf" aria-hidden="true" />
          <div>
            <h2 id="receipt-title" className="text-lg font-bold">Paid · {receiptNo(sale.sale_no)}</h2>
            <p className="text-sm text-bean">{fmtDateTime(sale.sold_at)}{cashier ? ` · ${cashier}` : ''}</p>
          </div>
        </div>
        <ul className="tabular mt-5 space-y-1.5 border-t border-dashed border-parchment pt-4 text-sm">
          {sale.sale_items.map((i, k) => (
            <li key={k} className="flex justify-between gap-3">
              <span><span className="text-bean">{i.qty}×</span> {i.product_name}</span>
              <span>{money(i.line_total)}</span>
            </li>
          ))}
        </ul>
        <dl className="tabular mt-4 space-y-1 border-t border-dashed border-parchment pt-3 text-sm">
          {Number(sale.discount) > 0 && <div className="flex justify-between text-bean"><dt>Discount</dt><dd>−{money(sale.discount)}</dd></div>}
          <div className="flex items-end justify-between"><dt className="font-bold">Total</dt><dd className="font-display text-3xl font-semibold">{money(sale.total)}</dd></div>
          <div className="flex justify-between text-bean"><dt>Paid by</dt><dd>{METHOD[sale.payment_method]}{sale.payment_ref ? ` …${sale.payment_ref}` : ''}</dd></div>
          {sale.amount_tendered != null && (
            <div className="flex justify-between text-lg font-bold text-teal-deep"><dt>Change</dt><dd>{money(sale.change_due ?? 0)}</dd></div>
          )}
          {sale.customer_name && <div className="flex justify-between text-bean"><dt>For</dt><dd>{sale.customer_name}</dd></div>}
          {sale.note && <div className="flex justify-between gap-4 text-bean"><dt>Note</dt><dd className="text-right">{sale.note}</dd></div>}
        </dl>
        <button type="button" autoFocus onClick={onDone} className="press mt-6 h-12 w-full rounded-xl bg-teal-deep font-bold text-paper hover:bg-[#264f4c]">
          New order
        </button>
      </motion.div>
    </motion.div>
  )
}
