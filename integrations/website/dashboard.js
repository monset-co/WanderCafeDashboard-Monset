// Website → dashboard bridge. Copy this file to WanderCafe-monset/api/_dashboard.js when the website goes
// live on the dashboard's Supabase project (steps: README.md beside this file).
// The database does the work (supabase/schema.sql section 12); this only maps the website's data onto it.

// Website menu id → POS product code (dashboard products.code). Matched by name and price on 2026-11-21.
// A new menu item needs a line here AND a product with that code in the dashboard (Inventory).
export const POS_CODE = {
  'signature-breakfast': 'CC01', 'rise-shine': 'CC02', ramen: 'CC03',
  'waffle-hearts': 'SW01', 'pancake-haven': 'SW02', 'yogurt-parfait': 'SW03',
  'plate-corned-beef': 'FP01', 'plate-tocino': 'FP02', 'plate-spam': 'FP03', 'plate-hotdog': 'FP04',
  'plate-ham': 'FP05', 'plate-chorizo': 'FP06', 'plate-sardines-run': 'FP07',
  'bacon-longaniza': 'CM01', 'sausage-ham': 'CM02',
  'spam-jam': 'SN01', 'mango-cream-cheese': 'SN02', 'tuna-melt': 'SN03', 'ham-egg': 'SN04', 'egg-cheese': 'SN05',
  carbonara: 'PA01', 'pasta-sardines': 'PA02', bolognese: 'PA03', 'asian-beef-pasta': 'PA04', 'beef-penne': 'PA05', sotanghon: 'PA06',
  'special-ramen': 'BW01', 'pancit-canton': 'BW02', pho: 'BW03', 'halo-halo': 'HH01',
  'coffee-espresso': 'CF01', 'coffee-americano': 'CF02', 'coffee-pour-over': 'CF03', 'coffee-latte': 'CF04',
  'coffee-cappuccino': 'CF05', 'coffee-caramel-macchiato': 'CF06', 'coffee-spanish': 'CF07', 'coffee-hazelnut': 'CF08',
  'coffee-vanilla': 'CF09', 'coffee-vietnamese': 'CF10', 'coffee-mocha': 'CF11',
  'sig-sunrise-spice': 'SG01', 'sig-orange-americano': 'SG02', 'sig-coconut-americano': 'SG03',
  'sig-strawberry-latte': 'SG04', 'sig-rose-latte': 'SG05', 'sig-mango-latte': 'SG06',
  'nc-fruit-shakes': 'NC01', 'nc-oreo-smoothie': 'NC02', 'nc-money-business': 'NC03', 'nc-strawberry-daydream': 'NC04',
  'nc-red-velvet-crush': 'NC05', 'nc-matcha-latte': 'NC06', 'nc-strawberry-matcha': 'NC07', 'nc-golden-milk-pink-milk': 'NC08',
}
// Paid choices (menu.js `price` on a choice) → their POS add-on. Free choices just ride along in the label.
export const EXTRA_CODE = { 'Black coffee': 'AD01', Juice: 'AD01', 'Add cheese slice': 'AD02' }

// One cart line as the orders table stores it: { code, label, unit, qty, extras }.
// `id` is the menu item id; `picked` the chosen choice labels (whatever api/checkout.js already has).
export const orderLine = ({ id, label, unit, qty, picked = [] }) => ({
  code: POS_CODE[id] ?? null, // unknown: still saved, the kitchen sees it flagged in the order note
  label,
  unit,
  qty,
  extras: picked.map((c) => EXTRA_CODE[c]).filter(Boolean),
})

// Call from api/paymongo-webhook.js once the signature checks out, instead of PATCHing status 'paid'.
// `db` is api/_db.js's helper. Returns its { ok, status, data }; not ok → answer 500 so PayMongo retries.
export function recordPaid(db, kind, ref, session) {
  const pay = session.payments?.[0]
  const p_payment_id = pay?.id ?? null
  return kind === 'order'
    ? db('rpc/record_web_order', { method: 'POST', body: { p_ref: ref, p_payment_id, p_method: pay?.attributes?.source?.type ?? null } })
    : db('rpc/confirm_web_booking', { method: 'POST', body: { p_ref: ref, p_payment_id } })
}
