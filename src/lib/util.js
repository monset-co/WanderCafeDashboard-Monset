export const round2 = (n) => Math.round(n * 100) / 100
const num = (n) => Number(n) || 0

// ₱50 for whole amounts, ₱27.50 otherwise.
export const money = (n) =>
  '₱' + num(n).toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(round2(num(n))) ? 0 : 2, maximumFractionDigits: 2 })
// Bookings store centavos (like PayMongo); the POS stores pesos.
export const cents = (c) => money(num(c) / 100)
export const shortPeso = (v) => (Math.abs(v) >= 1000 ? `₱${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : money(v))

// Reports group by Manila date, so "today" must too, whatever the device's clock zone.
export const manilaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
export const manilaMidnight = (d) => `${d}T00:00:00+08:00`

// ---- Calendar days as 'YYYY-MM-DD' ----
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
export const monthStart = (d) => d.slice(0, 8) + '01'
export const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
export const fmtDay = (d, o = { month: 'short', day: 'numeric' }) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', { timeZone: 'UTC', ...o })
export const fmtDateTime = (t) =>
  new Date(t).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// crypto.randomUUID only exists on HTTPS/localhost; a tablet on LAN http needs the fallback.
export const uuid = () =>
  crypto.randomUUID?.() ??
  '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16))

// onChange handlers that only accept what the field allows.
export const moneyInput = (set) => (e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && set(e.target.value)
export const intInput = (set) => (e) => /^\d*$/.test(e.target.value) && set(e.target.value)

export const plural = (n, w) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`
export const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–')

export const METHODS = [
  ['cash', 'Cash'],
  ['gcash', 'GCash'],
  ['maya', 'Maya'],
  ['card', 'Card'],
  ['bank_transfer', 'Bank'],
  ['other', 'Other'],
]
export const METHOD = Object.fromEntries(METHODS)
export const receiptNo = (n) => (n == null ? '—' : '#' + String(n).padStart(5, '0'))
