import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { CircleAlert, CircleCheck, CircleX, ClipboardCheck, EyeOff, History, PackageMinus, PackagePlus, Pencil, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { fmtDateTime, money, moneyInput, pct } from '../lib/util.js'
import { BTN, Badge, CARD, Chips, Empty, FIELD, Kpis, LABEL, PageHeader, Problem, Segmented, Sheet, SkeletonRows, Submit, useToast } from '../components/ui.jsx'
import { stockOf } from './Register.jsx'
import { useAuth } from '../auth.jsx'

const qtyInput = (set) => (e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && set(e.target.value)
const KIND = { made: 'Made to order', good: 'Ready to sell', supply: 'Supply' }
const BADGE = { low: ['warn', CircleAlert, 'Low'], out: ['bad', CircleX, 'Out'], ok: ['ok', CircleCheck, 'OK'] }
const qty = (n, unit) => `${+Number(n).toFixed(2)}${unit && unit !== 'pc' ? ` ${unit}` : ''}`

export default function Inventory() {
  const { isManager } = useAuth()
  const [products, setProducts] = useState(null)
  const [people, setPeople] = useState({})
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('All')
  const [view, setView] = useState('stock') // stock | menu | restock | hidden
  const [open, setOpen] = useState(null) // { id, tab } or { create: true }

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('products').select('*').order('category').order('sort').order('name')
    if (error) setError(error.message)
    else {
      setError(null)
      setProducts(data)
    }
  }, [])
  useEffect(() => {
    load()
    supabase.from('profiles').select('id, full_name').then(({ data }) => setPeople(Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name]))))
  }, [load])

  const all = products ?? []
  const stocked = all.filter((p) => p.is_active && p.kind !== 'made')
  const low = stocked.filter((p) => p.stock_qty <= p.reorder_level)
  const inView = (p) =>
    view === 'hidden' ? !p.is_active
    : !p.is_active ? false
    : view === 'stock' ? p.kind !== 'made'
    : view === 'menu' ? p.kind !== 'supply'
    : p.kind !== 'made' && p.stock_qty <= p.reorder_level
  const categories = useMemo(() => [...new Set(all.filter(inView).map((p) => p.category))], [all, view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (cat !== 'All' && !categories.includes(cat)) setCat('All')
  }, [categories, cat])
  const q = query.trim().toLowerCase()
  const rows = all.filter((p) => inView(p) && (cat === 'All' || p.category === cat) && (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)))
  const current = open?.id ? all.find((p) => p.id === open.id) : null

  return (
    <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader title="Inventory" sub="Stock, the menu and prices. Every change is logged with who made it.">
        {isManager && (
          <button type="button" onClick={() => setOpen({ create: true })} className={BTN.primary}>
            <Plus className="size-4" aria-hidden="true" /> Add item
          </button>
        )}
      </PageHeader>

      <div className="mt-6">
        <Kpis
          items={[
            { label: 'On the menu', value: products && all.filter((p) => p.is_active && p.kind !== 'supply').length, note: 'Items the register can sell' },
            { label: 'Need restocking', value: products && low.length, tone: low.length ? 'text-honey' : '', note: `${low.filter((p) => p.stock_qty <= 0).length} out · ${low.filter((p) => p.stock_qty > 0).length} low` },
            { label: 'Stock at cost', value: products && stocked.reduce((s, p) => s + Math.max(p.stock_qty, 0) * p.unit_cost, 0), fmt: money, note: 'Supplies and ready-to-sell goods' },
            { label: 'Goods at price', value: products && stocked.filter((p) => p.kind === 'good').reduce((s, p) => s + Math.max(p.stock_qty, 0) * p.selling_price, 0), fmt: money, note: 'If every bottle and snack sells' },
          ]}
        />
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative block lg:w-60 lg:shrink-0">
          <span className="sr-only">Search items</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-bean" aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or code" className={`${FIELD} pl-10`} />
        </label>
        <Chips id="inv-cat" label="Category" value={cat} onChange={setCat} options={['All', ...categories].map((c) => [c, c])} />
        <Segmented
          id="inv-view"
          className="lg:ml-auto lg:w-auto"
          value={view}
          onChange={setView}
          options={[
            ['stock', 'Stock'],
            ['menu', 'Menu'],
            ['restock', `Restock${low.length ? ` · ${low.length}` : ''}`],
            ['hidden', 'Hidden'],
          ]}
        />
      </div>

      {error && <div className="mt-4"><Problem onRetry={load}>Couldn't load inventory. {error}</Problem></div>}

      <div className={`${CARD} mt-4 overflow-hidden`}>
        {!products && !error && <SkeletonRows label="Loading inventory" />}
        {products && rows.length === 0 && (
          <Empty>
            {view === 'restock' ? 'Nothing needs restocking.'
              : view === 'hidden' ? 'No hidden items.'
              : view === 'stock' && !stocked.length ? (isManager ? 'No stock items yet. Add supplies (beans, milk, cups) and ready-to-sell goods with Add item, then receive deliveries here.' : 'No stock items yet. A manager can add them.')
              : 'Nothing matches.'}
          </Empty>
        )}
        {rows.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-parchment text-xs font-bold tracking-[0.08em] text-bean uppercase max-md:sr-only">
              <tr>
                <th scope="col" className="px-5 py-3 font-bold">Item</th>
                <th scope="col" className="px-3 py-3 font-bold">Stock</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Cost</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Price</th>
                <th scope="col" className="px-3 py-3 text-right font-bold">Margin</th>
                <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment/60">
              {rows.map((p) => <Row key={p.id} p={p} isManager={isManager} onOpen={(tab) => setOpen({ id: p.id, tab })} />)}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {open && (open.create || current) && (
          <Drawer
            key="drawer"
            product={current}
            tab={open.tab}
            isManager={isManager}
            categories={[...new Set(all.map((p) => p.category))]}
            people={people}
            onClose={() => setOpen(null)}
            onSaved={async (id, tab) => {
              await load()
              if (id) setOpen({ id, tab })
            }}
          />
        )}
      </AnimatePresence>
    </main>
  )
}

function Row({ p, isManager, onOpen }) {
  const s = stockOf(p)
  const [tone, Icon, text] = s ? BADGE[s.key] : []
  const stocked = p.kind !== 'made'
  return (
    <tr className="group transition-colors duration-150 hover:bg-cream max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:px-4 max-md:py-3">
      <td className="px-5 py-3 max-md:col-span-2 max-md:p-0">
        <button type="button" onClick={() => onOpen(stocked ? 'stock' : 'details')} className="text-left">
          <span className="font-bold group-hover:underline group-hover:decoration-teal group-hover:decoration-2 group-hover:underline-offset-4">{p.name}</span>
          <span className="mt-0.5 block text-xs text-bean">
            {p.code} · {p.category} · {KIND[p.kind]}
            {!p.is_active && <span className="ml-2 inline-flex items-center gap-1 font-semibold"><EyeOff className="size-3" aria-hidden="true" /> Hidden</span>}
          </span>
        </button>
      </td>
      <td className="px-3 py-3 max-md:p-0 max-md:pt-2">
        {stocked ? (
          <span className="flex items-center gap-2">
            <span className="tabular min-w-12 text-lg font-bold">{qty(p.stock_qty, p.unit)}</span>
            <Badge tone={tone} Icon={Icon}>{text}</Badge>
            <span className="text-xs text-bean max-lg:hidden">reorder at {qty(p.reorder_level, p.unit)}</span>
          </span>
        ) : (
          <span className="text-bean">Not counted</span>
        )}
      </td>
      <td className="tabular px-3 py-3 text-right text-bean max-md:hidden">{money(p.unit_cost)}</td>
      <td className="tabular px-3 py-3 text-right font-bold max-md:p-0 max-md:pt-2 max-md:text-left">{p.kind === 'supply' ? <span className="font-normal text-bean">—</span> : money(p.selling_price)}</td>
      <td className="tabular px-3 py-3 text-right max-md:hidden">{p.kind === 'supply' || !Number(p.unit_cost) ? <span className="text-bean">–</span> : pct(p.selling_price - p.unit_cost, p.selling_price)}</td>
      <td className="px-5 py-3 max-md:col-span-2 max-md:p-0 max-md:pt-3">
        <span className="flex justify-end gap-1.5 max-md:justify-start">
          {stocked && (
            <>
              <IconBtn onClick={() => onOpen('stock:receive')} Icon={PackagePlus} label="Receive" />
              <IconBtn onClick={() => onOpen('stock:count')} Icon={ClipboardCheck} label="Count" />
            </>
          )}
          <IconBtn onClick={() => onOpen('details')} Icon={Pencil} label={isManager ? 'Edit' : 'Details'} />
        </span>
      </td>
    </tr>
  )
}

function IconBtn({ Icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="press flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-bean ring-1 ring-parchment hover:bg-espresso hover:text-paper hover:ring-espresso">
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </button>
  )
}

function Drawer({ product, tab: initial = 'stock', isManager, categories, people, onClose, onSaved }) {
  const create = !product
  const stocked = product && product.kind !== 'made'
  const first = initial.split(':')[0]
  const [tab, setTab] = useState(create || (first === 'stock' && !stocked) ? 'details' : first)
  const tabs = [...(stocked ? [['stock', 'Stock', SlidersHorizontal]] : []), ['details', 'Details', Pencil], ['history', 'History', History]]
  return (
    <Sheet
      title={create ? 'New item' : product.name}
      subtitle={!create && `${product.code} · ${product.category} · ${KIND[product.kind]}`}
      onClose={onClose}
      header={!create && <Segmented id="drawer-tab" className="mt-4" value={tab} onChange={setTab} options={tabs} />}
    >
      {tab === 'stock' && stocked && <StockTab key={product.stock_qty} product={product} initial={initial.split(':')[1]} onDone={() => onSaved(product.id, 'stock')} />}
      {tab === 'details' && <DetailsTab product={product} isManager={isManager} categories={categories} onDone={(id) => onSaved(id, create ? 'stock' : 'details')} />}
      {tab === 'history' && product && <HistoryTab product={product} people={people} />}
    </Sheet>
  )
}

function StockTab({ product: p, initial = 'receive', onDone }) {
  const notify = useToast()
  const [mode, setMode] = useState(initial)
  const [n, setN] = useState('')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const value = Number(n)

  const submit = async (e) => {
    e.preventDefault()
    if (n === '' || (mode !== 'count' && value <= 0)) return setErr(mode === 'count' ? 'Enter what you counted.' : 'Enter how many.')
    setBusy(true)
    setErr(null)
    const { data: me } = await supabase.auth.getUser()
    let error
    if (mode === 'count') ({ error } = await supabase.rpc('set_stock_count', { p_product_id: p.id, p_counted: value, p_note: note.trim() || null }))
    else
      ({ error } = await supabase.from('stock_movements').insert({
        product_id: p.id,
        movement_type: mode === 'receive' ? 'purchase' : 'spoilage',
        qty: mode === 'receive' ? value : -value,
        unit_cost: mode === 'receive' && cost !== '' ? Number(cost) : null,
        supplier: supplier.trim() || null,
        note: note.trim() || null,
        created_by: me.user.id,
      }))
    setBusy(false)
    if (error) return setErr(error.message)
    const diff = value - p.stock_qty
    notify(mode === 'receive' ? `Received ${qty(value, p.unit)} of ${p.name}` : mode === 'waste' ? `${qty(value, p.unit)} of ${p.name} written off` : diff === 0 ? `${p.name}: count matches` : `${p.name} counted: ${diff > 0 ? '+' : ''}${+diff.toFixed(2)} adjusted`)
    onDone()
  }

  return (
    <div className="space-y-5">
      <div className={`${CARD} flex items-end justify-between p-5`}>
        <div>
          <p className="text-sm font-semibold text-bean">In stock now</p>
          <p className="tabular mt-1 font-display text-5xl leading-none font-semibold">{qty(p.stock_qty, p.unit)}</p>
        </div>
        <p className="text-right text-sm text-bean">Reorder at {qty(p.reorder_level, p.unit)}<br />Cost {money(p.unit_cost)} / {p.unit}</p>
      </div>
      <Segmented id="stock-mode" value={mode} onChange={(m) => (setMode(m), setErr(null))} options={[['receive', 'Receive', PackagePlus], ['waste', 'Waste', PackageMinus], ['count', 'Count', ClipboardCheck]]} />
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-bean">
          {mode === 'receive' ? 'A delivery or purchase. Adds to stock; a cost here becomes the item’s latest cost.' : mode === 'waste' ? 'Spoiled, spilled, expired or used up for staff. Taken off stock and counted as a loss.' : 'Count what’s actually on the shelf. The difference is recorded so the numbers match.'}
        </p>
        <label className={LABEL}>
          {mode === 'count' ? `Counted (${p.unit})` : `How many (${p.unit})`}
          <input inputMode="decimal" value={n} onChange={qtyInput(setN)} autoFocus className={`${FIELD} tabular mt-1.5 text-lg`} />
        </label>
        {mode === 'count' && n !== '' && (
          <p className="tabular text-sm font-semibold">{value === Number(p.stock_qty) ? 'Matches the records.' : `${value - p.stock_qty > 0 ? '+' : ''}${+(value - p.stock_qty).toFixed(2)} vs the records`}</p>
        )}
        {mode === 'receive' && (
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Cost per {p.unit} <span className="font-normal text-bean">(optional)</span>
              <input inputMode="decimal" value={cost} onChange={moneyInput(setCost)} placeholder={String(+p.unit_cost)} className={`${FIELD} tabular mt-1.5`} />
            </label>
            <label className={LABEL}>
              Supplier <span className="font-normal text-bean">(optional)</span>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={`${FIELD} mt-1.5`} />
            </label>
          </div>
        )}
        <label className={LABEL}>
          Note <span className="font-normal text-bean">(optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'waste' ? 'Expired, spilled…' : ''} className={`${FIELD} mt-1.5`} />
        </label>
        {err && <Problem>{err}</Problem>}
        <Submit busy={busy}>{mode === 'receive' ? 'Add to stock' : mode === 'waste' ? 'Write off' : 'Save count'}</Submit>
      </form>
    </div>
  )
}

function DetailsTab({ product: p, isManager, categories, onDone }) {
  const notify = useToast()
  const [f, setF] = useState({
    code: p?.code ?? '', name: p?.name ?? '', category: p?.category ?? '', kind: p?.kind ?? 'made', unit: p?.unit ?? 'pc',
    selling_price: p ? String(+p.selling_price) : '', unit_cost: p ? String(+p.unit_cost) : '', reorder_level: p ? String(+p.reorder_level) : '', is_active: p?.is_active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }))
  const ro = !isManager

  const save = async (e) => {
    e.preventDefault()
    if (!f.code.trim() || !f.name.trim() || !f.category.trim()) return setErr('Code, name and category are needed.')
    if (f.kind !== 'supply' && f.selling_price === '') return setErr('Enter the price.')
    setBusy(true)
    setErr(null)
    const row = {
      code: f.code.trim().toUpperCase(), name: f.name.trim(), category: f.category.trim(), kind: f.kind, unit: f.unit.trim() || 'pc',
      selling_price: f.kind === 'supply' ? 0 : Number(f.selling_price), unit_cost: Number(f.unit_cost) || 0,
      reorder_level: f.kind === 'made' ? 0 : Number(f.reorder_level) || 0, is_active: f.is_active,
    }
    const { data, error } = p ? await supabase.from('products').update(row).eq('id', p.id).select('id').single() : await supabase.from('products').insert(row).select('id').single()
    setBusy(false)
    if (error) return setErr(/duplicate|unique/i.test(error.message) ? 'Another item already uses that code.' : error.message)
    notify(p ? `${row.name} saved` : `${row.name} added${row.kind === 'made' ? ' to the menu' : '. Receive its opening stock next.'}`)
    onDone(data.id)
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {ro && <p className="rounded-lg bg-parchment/60 px-3.5 py-2.5 text-sm text-bean">Only a manager can change items and prices.</p>}
      <fieldset disabled={ro} className="space-y-4">
        <div role="radiogroup" aria-label="Type" className="grid gap-2">
          {[['made', 'Made to order', 'Cooked or brewed per order. Sold, not counted.'], ['good', 'Ready to sell', 'Bottled drinks, snacks. Sold and counted.'], ['supply', 'Supply', 'Beans, milk, cups. Counted, never sold.']].map(([v, t, d]) => (
            <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 transition-shadow duration-150 ${f.kind === v ? 'bg-paper ring-2 ring-teal-deep' : 'ring-parchment'}`}>
              <input type="radio" name="kind" value={v} checked={f.kind === v} onChange={set('kind')} className="mt-1 accent-teal-deep" />
              <span><span className="block font-bold">{t}</span><span className="text-sm text-bean">{d}</span></span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <label className={LABEL}>Code<input value={f.code} onChange={set('code')} placeholder="CF12" className={`${FIELD} mt-1.5 uppercase`} /></label>
          <label className={LABEL}>Name<input value={f.name} onChange={set('name')} className={`${FIELD} mt-1.5`} /></label>
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <label className={LABEL}>
            Category
            <input list="inv-cats" value={f.category} onChange={set('category')} className={`${FIELD} mt-1.5`} />
            <datalist id="inv-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className={LABEL}>Unit<input value={f.unit} onChange={set('unit')} placeholder="pc, kg, L" className={`${FIELD} mt-1.5`} /></label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {f.kind !== 'supply' && (
            <label className={LABEL}>Price<input inputMode="decimal" value={f.selling_price} onChange={moneyInput(set('selling_price'))} className={`${FIELD} tabular mt-1.5`} /></label>
          )}
          <label className={LABEL}>
            {f.kind === 'made' ? 'Food cost' : 'Cost'}
            <input inputMode="decimal" value={f.unit_cost} onChange={moneyInput(set('unit_cost'))} placeholder="0" className={`${FIELD} tabular mt-1.5`} />
          </label>
          {f.kind !== 'made' && (
            <label className={LABEL}>Reorder at<input inputMode="decimal" value={f.reorder_level} onChange={qtyInput(set('reorder_level'))} placeholder="0" className={`${FIELD} tabular mt-1.5`} /></label>
          )}
        </div>
        {f.kind === 'made' && <p className="text-xs text-bean">Food cost is your estimate of ingredients per serving. It turns sales into gross profit in Analytics.</p>}
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" checked={!f.is_active} onChange={(e) => set('is_active')(!e.target.checked)} className="size-4 accent-teal-deep" />
          Hide this item (off the register and lists; history kept)
        </label>
      </fieldset>
      {err && <Problem>{err}</Problem>}
      {!ro && <Submit busy={busy}>{p ? 'Save changes' : 'Add item'}</Submit>}
    </form>
  )
}

const FIELD_LABEL = { created: 'Created', name: 'Name', code: 'Code', category: 'Category', kind: 'Type', unit: 'Unit', unit_cost: 'Cost', selling_price: 'Price', reorder_level: 'Reorder at', is_active: 'Shown' }
const MOVE = { purchase: 'Received', sale: 'Sold', void: 'Void returned', spoilage: 'Written off', adjustment: 'Count adjusted' }

function HistoryTab({ product: p, people }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    Promise.all([
      supabase.from('product_changes').select('*').eq('product_id', p.id).order('changed_at', { ascending: false }).limit(100),
      supabase.from('stock_movements').select('*').eq('product_id', p.id).order('occurred_at', { ascending: false }).limit(100),
    ]).then(([c, m]) => {
      if (c.error || m.error) return setErr((c.error ?? m.error).message)
      setItems(
        [
          ...c.data.map((x) => ({ at: x.changed_at, who: x.changed_by, text: x.field === 'created' ? `Created “${x.new_value}”` : `${FIELD_LABEL[x.field] ?? x.field}: ${x.old_value ?? '–'} → ${x.new_value ?? '–'}` })),
          ...m.data.map((x) => ({ at: x.occurred_at, who: x.created_by, text: `${MOVE[x.movement_type]} ${x.qty > 0 ? '+' : ''}${+Number(x.qty).toFixed(2)}${x.unit_cost != null && x.movement_type === 'purchase' ? ` at ${money(x.unit_cost)}` : ''}${x.supplier ? ` from ${x.supplier}` : ''}`, note: x.note })),
        ].sort((a, b) => b.at.localeCompare(a.at)),
      )
    })
  }, [p.id])
  if (err) return <Problem>{err}</Problem>
  if (!items) return <SkeletonRows rows={4} h="h-14" />
  if (!items.length) return <Empty>No history yet.</Empty>
  return (
    <ol className="space-y-3">
      {items.map((x, k) => (
        <li key={k} className="border-l-2 border-parchment pl-3">
          <p className="text-sm font-semibold">{x.text}</p>
          {x.note && <p className="text-sm text-bean">“{x.note}”</p>}
          <p className="text-xs text-bean">{fmtDateTime(x.at)} · {people[x.who] ?? 'Someone'}</p>
        </li>
      ))}
    </ol>
  )
}
