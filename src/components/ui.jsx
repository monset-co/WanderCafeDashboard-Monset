import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react'
import { Check, CircleAlert, CircleCheck, Loader2, X } from 'lucide-react'
import { addDays, fmtDay, manilaToday, monthStart } from '../lib/util.js'

export const EASE_OUT = [0.23, 1, 0.32, 1]
export const EASE_DRAWER = [0.32, 0.72, 0, 1]

// ---- Shared class names: one control vocabulary across every page ----
export const FIELD =
  'h-11 w-full rounded-lg bg-paper px-3 text-espresso ring-1 ring-parchment outline-none transition-shadow duration-150 placeholder:text-bean/70 focus:ring-2 focus:ring-teal-deep disabled:opacity-50'
export const LABEL = 'block text-sm font-semibold text-espresso'
export const BTN = {
  primary: 'press inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-teal-deep px-4 font-semibold text-paper hover:bg-[#264f4c] disabled:opacity-45',
  quiet: 'press inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-paper px-4 font-semibold text-espresso ring-1 ring-parchment hover:ring-bean/40 disabled:opacity-45',
  danger: 'press inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-tomato px-4 font-semibold text-paper hover:bg-[#9a3626] disabled:opacity-45',
}
export const CARD = 'rounded-xl bg-paper ring-1 ring-parchment/70 shadow-[0_1px_2px_rgb(74_52_40/0.06)]'

// Animates from the previous value to the new one; interruptible because it rides one motion value.
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString('en-PH'), duration = 0.5 }) {
  const ref = useRef(null)
  const mv = useMotionValue(value)
  useEffect(() => {
    const c = animate(mv, value, { duration, ease: EASE_OUT })
    return () => c.stop()
  }, [mv, value, duration])
  useMotionValueEvent(mv, 'change', (v) => ref.current && (ref.current.textContent = format(v)))
  return <span ref={ref}>{format(value)}</span>
}

export function PageHeader({ title, sub, children }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-4xl leading-none font-semibold tracking-[-0.02em] text-espresso sm:text-[2.75rem]">{title}</h1>
        {sub && <p className="mt-2 text-bean">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}

// Segmented control with a sliding pill; `id` must be unique on the page.
export function Segmented({ id, options, value, onChange, className = '' }) {
  return (
    <div role="tablist" className={`flex gap-1 rounded-lg bg-parchment/60 p-1 ${className}`}>
      {options.map(([v, label, Icon]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)} className="press relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold whitespace-nowrap">
          {value === v && <motion.span layoutId={id} className="absolute inset-0 rounded-md bg-paper shadow-[0_1px_3px_rgb(74_52_40/0.18)]" transition={{ type: 'spring', duration: 0.3, bounce: 0 }} />}
          {Icon && <Icon className="relative size-4" aria-hidden="true" />}
          <span className={`relative transition-colors duration-150 ${value === v ? 'text-espresso' : 'text-bean hover:text-espresso'}`}>{label}</span>
        </button>
      ))}
    </div>
  )
}

// Chip row (categories, filters) with one shared moving pill.
export function Chips({ id, options, value, onChange, label }) {
  return (
    <div className="-mx-4 flex min-w-0 gap-1 overflow-x-auto px-4 md:mx-0 md:px-0" role="group" aria-label={label}>
      {options.map(([v, text, count]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v} className="press relative h-10 shrink-0 rounded-full px-4 text-sm font-semibold">
          {value === v && <motion.span layoutId={id} className="absolute inset-0 rounded-full bg-espresso" transition={{ type: 'spring', duration: 0.3, bounce: 0 }} />}
          <span className={`relative transition-colors duration-150 ${value === v ? 'text-paper' : 'text-bean hover:text-espresso'}`}>
            {text}
            {count != null && <span className="tabular ml-1.5 opacity-60">{count}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

// Right-side panel over a dimmed page, full width on phones. Esc or the backdrop closes it.
// Render inside <AnimatePresence> so it slides out too (faster than it came in).
export function Sheet({ title, subtitle, onClose, header, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <motion.div className="fixed inset-0 z-40" initial="out" animate="in" exit="gone">
      <motion.div
        className="absolute inset-0 bg-roast/45"
        variants={{ out: { opacity: 0 }, in: { opacity: 1, transition: { duration: 0.2 } }, gone: { opacity: 0, transition: { duration: 0.18 } } }}
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className={`absolute inset-y-0 right-0 flex w-full flex-col bg-cream shadow-[-24px_0_60px_-24px_rgb(51_36_28/0.5)] ${wide ? 'sm:w-[38rem]' : 'sm:w-[32rem]'}`}
        variants={{
          out: { transform: 'translateX(100%)' },
          in: { transform: 'translateX(0%)', transition: { duration: 0.36, ease: EASE_DRAWER } },
          gone: { transform: 'translateX(100%)', transition: { duration: 0.22, ease: EASE_DRAWER } },
        }}
      >
        <header className="shrink-0 border-b border-parchment bg-paper px-5 pt-5 pb-4 short:pt-3 short:pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="sheet-title" className="truncate font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">
                {title}
              </h2>
              {subtitle && <p className="mt-0.5 text-sm text-bean">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="press grid size-10 shrink-0 place-items-center rounded-lg text-bean ring-1 ring-parchment hover:text-espresso">
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          {header}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))]">{children}</div>
        {footer && <div className="shrink-0 border-t border-parchment bg-paper/95 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </motion.aside>
    </motion.div>
  )
}

export function Problem({ children, onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg bg-tomato/10 px-3.5 py-3 text-sm font-semibold text-tomato">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="press rounded-md bg-tomato px-3 py-1 text-paper">
          Try again
        </button>
      )}
    </div>
  )
}

export function Submit({ busy, children, disabled, tone = 'primary', className = '' }) {
  return (
    <button type="submit" disabled={busy || disabled} className={`${BTN[tone]} h-12 w-full text-base ${className}`}>
      {busy && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function Empty({ children, className = '' }) {
  return <p className={`grid min-h-40 place-items-center px-6 py-10 text-center text-bean ${className}`}>{children}</p>
}

export function SkeletonRows({ rows = 6, h = 'h-16', label = 'Loading' }) {
  return (
    <div role="status" aria-label={label} className="divide-y divide-parchment/60">
      {Array.from({ length: rows }, (_, k) => (
        <div key={k} className={`${h} px-5 py-4`}>
          <div className="skeleton h-4 w-1/3 rounded" style={{ animationDelay: `${k * 70}ms` }} />
          <div className="skeleton mt-2 h-3 w-1/5 rounded opacity-70" style={{ animationDelay: `${k * 70 + 35}ms` }} />
        </div>
      ))}
    </div>
  )
}

// Status always as icon + word, never colour alone.
const TONES = {
  ok: 'bg-leaf/10 text-leaf',
  warn: 'bg-honey/12 text-honey',
  bad: 'bg-tomato/10 text-tomato',
  info: 'bg-teal/12 text-teal-deep',
  muted: 'bg-parchment/70 text-bean',
}
export function Badge({ tone = 'muted', Icon, children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${TONES[tone]}`}>
      {Icon && <Icon className="size-3.5" aria-hidden="true" />}
      {children}
    </span>
  )
}

// ---- Motionbook B7 Hold to Confirm (Tactile), as a pill: a fill sweeps across while held (1.2s,
// linear: the user is deciding); letting go early drains it fast (200ms ease-out). Space/Enter hold too.
export function HoldButton({ onConfirm, Icon, children, doneLabel = 'Done', ms = 1200, className = '' }) {
  const [holding, setHolding] = useState(false)
  const [done, setDone] = useState(false)
  const timer = useRef()
  useEffect(() => () => clearTimeout(timer.current), [])
  const start = () => {
    if (done) return
    setHolding(true)
    timer.current = setTimeout(() => {
      setHolding(false)
      setDone(true)
      navigator.vibrate?.(20)
      onConfirm()
    }, ms)
  }
  const stop = () => (clearTimeout(timer.current), setHolding(false))
  const key = (e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), e.type === 'keydown' ? !e.repeat && start() : stop())
  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={key}
      onKeyUp={key}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Hold to ${String(children).toLowerCase()}`}
      className={`press relative inline-flex h-11 touch-none items-center justify-center overflow-hidden rounded-lg px-4 font-semibold text-tomato ring-1 ring-tomato/35 select-none ${className}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-tomato"
        style={{ clipPath: holding || done ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)', transition: `clip-path ${holding ? `${ms}ms linear` : '200ms var(--ease-out)'}` }}
      />
      <span className={`relative flex items-center gap-2 transition-colors duration-150 ${holding || done ? 'text-paper' : ''}`} aria-live="polite">
        {done ? <Check className="size-4" aria-hidden="true" /> : Icon && <Icon className="size-4" aria-hidden="true" />}
        {done ? doneLabel : holding ? 'Keep holding…' : children}
      </span>
    </button>
  )
}

// ---- Motionbook D4 Paper Plane (Tactile): Wander's paper plane pulls back, then flies off along a
// dashed trail. Decorative only: the heading next to it says what happened. Skipped for reduced motion.
const FLIGHT = { duration: 1.05, times: [0, 0.18, 0.38, 0.58, 0.8, 1], ease: 'easeInOut' }
export function PlaneOff() {
  const reduce = useReducedMotion()
  if (reduce) return null
  return (
    <div className="pointer-events-none relative h-16 w-[240px]" aria-hidden="true">
      <svg viewBox="0 0 240 64" width="240" height="64" className="absolute inset-0 overflow-visible">
        <defs>
          <clipPath id="plane-trail">
            <motion.rect x="0" y="-20" height="100" initial={{ width: 0 }} animate={{ width: 240 }} transition={{ delay: 0.19, duration: 0.86, ease: [0.65, 0, 0.35, 1] }} />
          </clipPath>
        </defs>
        <motion.path
          d="M20 48 C 80 56, 140 40, 230 6"
          fill="none"
          stroke="var(--color-teal)"
          strokeWidth="2"
          strokeDasharray="3 7"
          strokeLinecap="round"
          clipPath="url(#plane-trail)"
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ delay: 1, duration: 0.5 }}
        />
      </svg>
      <motion.svg
        viewBox="-22 -10 24 20"
        width="26"
        height="22"
        className="absolute"
        style={{ left: 8, top: 37 }}
        initial={{ transform: 'translate(0px,0px) rotate(8deg)', opacity: 1 }}
        animate={{
          transform: ['translate(0px,0px) rotate(8deg)', 'translate(-10px,2px) rotate(10deg)', 'translate(45px,2px) rotate(4deg)', 'translate(94px,-5px) rotate(-10deg)', 'translate(148px,-20px) rotate(-22deg)', 'translate(214px,-44px) rotate(-30deg)'],
          opacity: [1, 1, 1, 1, 1, 0],
        }}
        transition={FLIGHT}
      >
        <path d="M0 0L-20-8-13 1Z" fill="var(--color-teal-deep)" />
        <path d="M0 0-13 1-16 9Z" fill="var(--color-teal)" />
      </motion.svg>
    </div>
  )
}

// ---- Toasts with undo (Sermon on the Mount dashboard) ----
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timer = useRef()
  const notify = useCallback((msg, { undo, tone = 'ok' } = {}) => {
    clearTimeout(timer.current)
    setToast({ msg, undo, tone, id: Date.now() })
    timer.current = setTimeout(() => setToast(null), undo ? 6000 : 4000)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-[70] flex justify-center px-4" aria-live="polite">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, transform: 'translateY(16px) scale(0.96)' }}
              animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
              exit={{ opacity: 0, transform: 'translateY(8px) scale(0.98)', transition: { duration: 0.15 } }}
              transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              className="pointer-events-auto flex max-w-lg items-center gap-3 rounded-full bg-roast py-2.5 pr-2.5 pl-4 text-sm text-paper shadow-[0_16px_40px_-12px_rgb(51_36_28/0.6)]"
            >
              {toast.tone === 'bad' ? <CircleAlert className="size-4 shrink-0 text-[#f2a08f]" aria-hidden="true" /> : <CircleCheck className="size-4 shrink-0 text-tiffany" aria-hidden="true" />}
              <span className="min-w-0">{toast.msg}</span>
              {toast.undo ? (
                <button type="button" onClick={() => (toast.undo(), setToast(null))} className="press shrink-0 rounded-full bg-paper/10 px-3.5 py-1.5 font-bold text-tiffany hover:bg-paper/20">
                  Undo
                </button>
              ) : (
                <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="press grid size-7 shrink-0 place-items-center rounded-full text-foam hover:text-paper">
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

// ---- Date ranges ----
export function presets() {
  const t = manilaToday()
  const lmEnd = addDays(monthStart(t), -1)
  return [
    ['today', 'Today', t, t],
    ['7d', '7 days', addDays(t, -6), t],
    ['30d', '30 days', addDays(t, -29), t],
    ['month', 'This month', monthStart(t), t],
    ['lastmonth', 'Last month', monthStart(lmEnd), lmEnd],
    ['year', 'This year', t.slice(0, 4) + '-01-01', t],
  ]
}

export function RangePicker({ opts, range, setRange, id = 'range', future = false }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-paper p-1 ring-1 ring-parchment" role="group" aria-label="Date range">
        {opts.map(([key, label, from, to]) => (
          <button key={key} type="button" aria-pressed={range.key === key} onClick={() => setRange({ key, from, to })} className="press relative h-9 shrink-0 rounded-md px-3 text-sm font-semibold">
            {range.key === key && <motion.span layoutId={`${id}-pill`} className="absolute inset-0 rounded-md bg-espresso" transition={{ type: 'spring', duration: 0.3, bounce: 0 }} />}
            <span className={`relative transition-colors duration-150 ${range.key === key ? 'text-paper' : 'text-bean hover:text-espresso'}`}>{label}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        <label className="sr-only" htmlFor={`${id}-from`}>From</label>
        <input id={`${id}-from`} type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ key: 'custom', from: e.target.value, to: range.to })} className="tabular h-11 rounded-lg bg-paper px-2.5 ring-1 ring-parchment outline-none focus:ring-2 focus:ring-teal-deep" />
        <span className="text-bean">to</span>
        <label className="sr-only" htmlFor={`${id}-to`}>To</label>
        <input id={`${id}-to`} type="date" value={range.to} min={range.from} max={future ? undefined : manilaToday()} onChange={(e) => e.target.value && setRange({ key: 'custom', from: range.from, to: e.target.value })} className="tabular h-11 rounded-lg bg-paper px-2.5 ring-1 ring-parchment outline-none focus:ring-2 focus:ring-teal-deep" />
      </div>
    </div>
  )
}

export const rangeLabel = (r) =>
  r.from === r.to
    ? fmtDay(r.from, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : `${fmtDay(r.from, { month: 'long', day: 'numeric', year: 'numeric' })} – ${fmtDay(r.to, { month: 'long', day: 'numeric', year: 'numeric' })}`

// KPI strip: a row of figures in one surface (not a grid of cards).
export function Kpis({ items }) {
  return (
    <dl className={`${CARD} grid grid-cols-2 divide-parchment/70 overflow-hidden ${items.length % 4 === 0 ? 'lg:grid-cols-4' : 'md:grid-cols-3 xl:grid-cols-6'}`}>
      {items.map((k) => (
        <div key={k.label} className="border-parchment/70 p-5 [&:not(:last-child)]:border-r max-md:[&:nth-child(2n)]:border-r-0 max-xl:border-b">
          <dt className="text-sm font-semibold text-bean">{k.label}</dt>
          <dd className={`tabular mt-2 font-display leading-none font-semibold tracking-[-0.02em] ${typeof k.value === 'number' ? 'text-3xl sm:text-[2.1rem]' : 'truncate text-2xl'} ${k.tone ?? ''}`} title={typeof k.value === 'string' ? k.value : undefined}>
            {k.value == null ? '–' : typeof k.value === 'number' ? <CountUp value={k.value} format={k.fmt} duration={0.6} /> : k.value}
          </dd>
          {k.note && <dd className="tabular mt-1.5 text-xs text-bean">{k.note}</dd>}
        </div>
      ))}
    </dl>
  )
}

export function Panel({ title, note, children, className = '', action }) {
  return (
    <section className={`${CARD} p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg leading-tight font-bold">{title}</h2>
          {note && <p className="mt-0.5 text-sm text-bean">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
