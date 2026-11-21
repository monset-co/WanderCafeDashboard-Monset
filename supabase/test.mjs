// Runs schema.sql (twice: it must be safe to re-run) in a real Postgres (PGlite, in-process),
// then checks roles, checkout, stock, voids, reports and bookings as admin / manager / staff / inactive.
// npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'

const db = new PGlite({ extensions: { btree_gist } })
// Minimal Supabase stand-in: auth schema, auth.uid() from a session setting, the API roles.
// No default grants: new Supabase projects don't expose tables to the API until granted, so the schema must.
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`)
const sql = readFileSync(new URL('schema.sql', import.meta.url), 'utf8').replace(/create extension if not exists pgcrypto;/, '')
await db.exec(sql)
await db.exec(sql)
console.log('applied schema.sql twice')

const A = '00000000-0000-0000-0000-00000000000a', M = '00000000-0000-0000-0000-00000000000b'
const S = '00000000-0000-0000-0000-00000000000c', X = '00000000-0000-0000-0000-00000000000d'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${A}', 'admin@x', '{"full_name":"Ana Admin"}'), ('${M}', 'mgr@x', '{"full_name":"Mia Manager"}'),
  ('${S}', 'staff@x', '{"full_name":"Sam Staff"}'), ('${X}', 'rand@x', '{}');
  update public.profiles set role = 'admin' where id = '${A}';
  update public.profiles set role = 'manager' where id = '${M}';
  update public.profiles set role = 'staff' where id = '${S}';`)
const as = async (uid, q, params) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid])
  await db.exec('set role authenticated')
  try { return (await db.query(q, params)).rows } finally { await db.exec('reset role') }
}
const fails = (uid, q, re, params) => assert.rejects(as(uid, q, params), re)
const one = async (q) => (await db.query(q)).rows[0]
let n = 0
const ok = (m) => console.log(`  ✓ ${++n} ${m}`)

// ---- roles ----
assert.equal((await one(`select role from profiles where id = '${X}'`)).role, 'inactive'); ok('new sign-up starts inactive')
assert.equal((await as(X, 'select * from products')).length, 0); ok('inactive user sees no products')
await fails(X, `select record_sale('[]'::jsonb)`, /Not authorized/); ok('inactive user cannot sell')
await fails(S, `update profiles set role = 'admin' where id = '${S}'`, /./).catch(() => {})
assert.equal((await one(`select role from profiles where id = '${S}'`)).role, 'staff'); ok('staff cannot promote themselves')
await fails(A, `update profiles set role = 'staff' where id = '${A}'`, /at least one admin/); ok('last admin cannot be demoted')
await fails(M, 'select * from staff_list()', /Only an admin/); ok('manager cannot list logins')

// ---- products and stock ----
const latte = (await one(`select id from products where code = 'CF04'`)).id
await as(M, `insert into products (code, name, category, kind, unit_cost, selling_price, reorder_level) values ('GD01', 'Bottled Water', 'Drinks', 'good', 10, 35, 6)`)
const water = (await one(`select id from products where code = 'GD01'`)).id
await fails(S, `insert into products (code, name, selling_price) values ('X1','x',1)`, /row-level security/); ok('staff cannot add products')
await fails(M, `update products set stock_qty = 99 where id = $1`, /permission denied/, [water]); ok('stock cannot be typed in directly')
await as(M, `update products set selling_price = 40 where id = $1`, [water])
const ch = await one(`select old_value, new_value, changed_by from product_changes where product_id = '${water}' and field = 'selling_price'`)
assert.deepEqual([ch.old_value, ch.new_value, ch.changed_by], ['35.00', '40.00', M]); ok('price change 35 → 40 logged under the manager')

await as(S, `insert into stock_movements (product_id, movement_type, qty, unit_cost, created_by) values ($1, 'purchase', 24, 12, $2)`, [water, S])
let w = await one(`select stock_qty, unit_cost from products where id = '${water}'`)
assert.deepEqual([+w.stock_qty, +w.unit_cost], [24, 12]); ok('staff receives 24 at ₱12: stock 24, cost updated')
await fails(S, `insert into stock_movements (product_id, movement_type, qty, created_by) values ($1, 'adjustment', 5, $2)`, /row-level security/, [water, S]); ok('adjustments only through a count')
await fails(S, `insert into stock_movements (product_id, movement_type, qty, created_by) values ($1, 'purchase', 5, $2)`, /row-level security/, [water, M]); ok('cannot sign a movement as someone else')

// ---- checkout ----
const sale = `select record_sale($1::jsonb, 'cash', 0, 500, null, null, $2::uuid) as id`
const cart = JSON.stringify([{ product_id: latte, qty: 2 }, { product_id: water, qty: 3 }])
const ref = '11111111-1111-1111-1111-111111111111'
const id1 = (await as(S, sale, [cart, ref]))[0].id
const id2 = (await as(S, sale, [cart, ref]))[0].id
assert.equal(id1, id2); assert.equal((await one('select count(*)::int c from sales')).c, 1); ok('retried checkout returns the same sale')
const s1 = await one(`select total, change_due, staff_id from sales where id = '${id1}'`)
assert.deepEqual([+s1.total, +s1.change_due, s1.staff_id], [380, 120, S]); ok('2 lattes + 3 water = ₱380, change ₱120, signed by staff')
assert.equal(+(await one(`select stock_qty from products where id = '${water}'`)).stock_qty, 21); ok('water stock 21 after sale; made items untouched')
await fails(S, `select record_sale($1::jsonb)`, /Not enough stock/, [JSON.stringify([{ product_id: water, qty: 50 }])]); ok('overselling blocked')
await fails(S, `select record_sale($1::jsonb, 'gcash')`, /last 4 digits/, [cart]); ok('GCash needs a reference')
await as(M, `insert into products (code, name, category, kind, unit) values ('SP01', 'Milk', 'Dairy', 'supply', 'L')`)
const milk = (await one(`select id from products where code = 'SP01'`)).id
await fails(S, `select record_sale($1::jsonb)`, /supply/, [JSON.stringify([{ product_id: milk, qty: 1 }])]); ok('supplies cannot be sold')
await as(S, `select record_sale($1::jsonb, 'gcash', 30, null, 'Lea', null, null, '0427')`, [JSON.stringify([{ product_id: latte, qty: 1 }])])
await as(M, `select record_sale($1::jsonb, 'cash')`, [JSON.stringify([{ product_id: latte, qty: 1 }])])
assert.equal((await as(S, 'select * from sales')).length, 2); ok('staff only see their own receipts')
assert.equal((await as(M, 'select * from sales')).length, 3); ok('manager sees every receipt')

// ---- counts and voids ----
assert.equal(+(await as(S, `select set_stock_count($1, 20) as d`, [water]))[0].d, -1); ok('count of 20 records −1')
assert.equal(+(await as(S, `select set_stock_count($1, 2.5) as d`, [milk]))[0].d, 2.5); ok('supplies count in decimals (2.5 L)')
await fails(S, `select set_stock_count($1, 3)`, /no stock to count/, [latte]); ok('made items cannot be counted')
await fails(S, `select void_sale($1, 'oops')`, /Only a manager/, [id1]); ok('staff cannot void')
await fails(M, `select void_sale($1, ' ')`, /reason/, [id1]); ok('void needs a reason')
await as(M, `select void_sale($1, 'Wrong order')`, [id1])
assert.equal(+(await one(`select stock_qty from products where id = '${water}'`)).stock_qty, 23); ok('void puts 3 water back (20 → 23)')
await fails(M, `select void_sale($1, 'again')`, /already voided/, [id1]); ok('cannot void twice')

// ---- reports ----
await fails(S, `select sales_report(current_date - 6, current_date)`, /Only a manager/); ok('staff cannot open analytics')
const today = `(now() at time zone 'Asia/Manila')::date`
const r = (await as(M, `select sales_report(${today} - 6, ${today}) as r`))[0].r
assert.equal(+r.totals.revenue, 100 + 130); assert.equal(r.totals.receipts, 2); assert.equal(r.voids.count, 1); assert.equal(r.daily.length, 7)
assert.equal(r.staff.length, 2); assert.equal(+r.totals.discounts, 30); ok('report: ₱230 from 2 receipts, 1 void, ₱30 discounts, 7 days')
const st = (await as(M, `select stock_report(${today} - 6, ${today}) as r`))[0].r
assert.equal(+st.purchases, 24 * 12); assert.equal(+st.losses, 12); ok('stock report: ₱288 bought, ₱12 lost (1 water at cost)')

// ---- bookings ----
const book = (uid, room, cin, cout, status = 'confirmed', extra = '') =>
  as(uid, `insert into bookings (room_id, check_in, check_out, guests, name, phone, total, deposit, status, source${extra ? ', paid' : ''})
            values ($1, $2, $3, 2, 'Juan Cruz', '09171234567', 360000, 180000, $4, 'phone'${extra ? ', ' + extra : ''}) returning id, ref`, [room, cin, cout, status])
const b1 = (await book(S, 'room-a', '2030-01-10', '2030-01-12'))[0]
assert.match(b1.ref, /^WDR-[0-9A-F]{6}$/); ok('staff adds a phone booking, ref ' + b1.ref)
await fails(S, `insert into bookings (room_id, check_in, check_out, name, source) values ('room-a', '2030-01-11', '2030-01-13', 'Ana Reyes', 'walk_in')`, /no_double_booking/); ok('overlapping stay in the same room is refused')
await book(S, 'room-a', '2030-01-12', '2030-01-13'); ok('check-out day is free for the next guest')
await book(S, 'room-b', '2030-01-10', '2030-01-12'); ok('other room, same dates is fine')
await fails(S, `insert into bookings (room_id, check_in, check_out, name) values ('room-a', '2030-02-01', '2030-02-02', 'Web Fake')`, /row-level security/); ok("staff can't fake a website booking")
await as(S, `update bookings set paid = 180000, status = 'checked_in' where id = $1`, [b1.id])
await fails(S, `update bookings set check_out = '2030-01-15' where id = $1`, /Only a manager/, [b1.id]); ok('staff cannot change dates')
await fails(S, `update bookings set status = 'cancelled' where id = $1`, /Only a manager/, [b1.id]); ok('staff cannot cancel')
await fails(S, `update bookings set ref = 'WDR-HACKED' where id = $1`, /permission denied/, [b1.id]); ok('ref is fixed once written')
await fails(S, `delete from bookings where id = $1`, /permission denied/, [b1.id]); ok('bookings are never deleted')
const log = await one(`select count(*)::int c from booking_changes where booking_id = ${b1.id} and field in ('paid', 'status') and changed_by = '${S}'`)
assert.equal(log.c, 2); ok('payment and check-in logged under staff')
const cancelled = (await book(M, 'room-b', '2030-01-20', '2030-01-22', 'cancelled'))[0]
await book(M, 'room-b', '2030-01-20', '2030-01-22'); ok('cancelled stays free their dates')
assert.ok(cancelled.id)
const br = (await as(M, `select bookings_report('2030-01-01', '2030-01-31') as r`))[0].r
// room-a 10–12 (2n) + 12–13 (1n), room-b 10–12 (2n) + 20–22 (2n) = 7 nights of 62
assert.equal(br.nights_sold, 7); assert.equal(br.nights_available, 62); assert.equal(br.cancelled, 1)
assert.equal(+br.revenue, 360000 + 360000 + 360000 + 360000); ok('bookings report: 7 of 62 nights, ₱14,400 room revenue, 1 cancellation')
await fails(S, `select bookings_report('2030-01-01', '2030-01-31')`, /Only a manager/); ok('staff cannot open the rooms report')

// ---- order board ----
const ord = (uid, items, type) => as(uid, `select record_sale($1::jsonb, 'cash', 0, null, 'Table 4', 'no ice', null, null, $2) as id`, [JSON.stringify(items), type]).then((r) => r[0].id)
const o1 = await ord(M, [{ product_id: latte, qty: 1 }], 'take_out')
const o2 = await ord(M, [{ product_id: water, qty: 1 }], 'delivery')
const s1o = await one(`select order_type, order_status, completed_at from sales where id = '${o1}'`)
assert.deepEqual([s1o.order_type, s1o.order_status, s1o.completed_at], ['take_out', 'preparing', null]); ok('a latte to take out starts preparing')
assert.equal((await one(`select order_status from sales where id = '${o2}'`)).order_status, 'completed'); ok('bottled goods only: completed straight away')
await fails(M, `select record_sale($1::jsonb, 'cash', 0, null, null, null, null, null, 'drive_thru')`, /dine-in, take-out or delivery/, [JSON.stringify([{ product_id: latte, qty: 1 }])]); ok('unknown order type refused')
const board = (await as(S, 'select order_board() as b'))[0].b
const mine = board.find((o) => o.id === o1)
assert.ok(mine && !('total' in mine)); assert.deepEqual(mine.items, [{ name: 'Latte', qty: 1 }]); assert.equal(mine.note, 'no ice')
ok("staff see the manager's order on the board: items and note, no money")
await as(S, `select set_order_status($1, 'completed')`, [o1])
const done1 = await one(`select order_status, completed_by from sales where id = '${o1}'`)
assert.deepEqual([done1.order_status, done1.completed_by], ['completed', S]); ok('staff mark it completed, signed by them')
await as(S, `select set_order_status($1, 'preparing')`, [o1])
assert.equal((await one(`select completed_at from sales where id = '${o1}'`)).completed_at, null); ok('undo puts it back to preparing')
await as(M, `select void_sale($1, 'Customer left')`, [o1])
assert.ok(!(await as(S, 'select order_board() as b'))[0].b.some((o) => o.id === o1)); ok('a voided order leaves the board')
await fails(S, `select set_order_status($1, 'completed')`, /voided/, [o1]); ok('voided orders cannot be completed')
await fails(X, 'select order_board()', /Not authorized/); ok('inactive users see no orders')
const types = (await as(M, `select sales_report(${today}, ${today}) as r`))[0].r.types
assert.ok(types.some((t) => t.type === 'delivery')); ok('the sales report splits by dine-in / take-out / delivery')

// ---- schedule ----
await as(M, `insert into shifts (staff_id, shift_date, start_time, end_time, station) values ($1, '2030-02-02', '07:00', '15:00', 'Counter')`, [S])
await fails(M, `insert into shifts (staff_id, shift_date, start_time, end_time) values ($1, '2030-02-02', '14:00', '20:00')`, /shifts_no_overlap/, [S]); ok('overlapping shifts for one person refused')
await as(M, `insert into shifts (staff_id, shift_date, start_time, end_time) values ($1, '2030-02-02', '15:00', '20:00')`, [S]); ok('back-to-back shifts are fine')
await fails(M, `insert into shifts (staff_id, shift_date, start_time, end_time) values ($1, '2030-02-03', '15:00', '09:00')`, /shifts_times/, [S]); ok('a shift must end after it starts')
await fails(S, `insert into shifts (staff_id, shift_date, start_time, end_time) values ($1, '2030-02-04', '07:00', '15:00')`, /row-level security/, [S]); ok('staff cannot write the schedule')
assert.equal((await as(S, `select * from shifts where shift_date = '2030-02-02'`)).length, 2); ok('staff can read the whole schedule')
await as(M, `delete from shifts where shift_date = '2030-02-02' and start_time = '15:00'`)
assert.equal((await one(`select count(*)::int c from shifts`)).c, 1); ok('managers remove shifts')

// ---- updates and push subscriptions ----
await as(A, `insert into announcements (title, body) values ('New menu Monday', 'Pho is back.')`)
await as(A, `insert into announcements (title, audience) values ('Payroll moved to Friday', 'managers')`)
await fails(M, `insert into announcements (title) values ('From a manager')`, /row-level security/); ok('only admins post updates')
assert.deepEqual((await as(S, 'select title from announcements')).map((r) => r.title), ['New menu Monday']); ok('staff see updates for everyone, not managers-only ones')
assert.equal((await as(M, 'select title from announcements')).length, 2); ok('managers see both')
assert.equal((await as(X, 'select title from announcements')).length, 0); ok('inactive users see none')
await as(S, `select save_push_subscription('https://push.example/abc', 'BKEY', 'AUTH', 'Edge')`)
await as(S, `select save_push_subscription('https://push.example/abc', 'BKEY2', 'AUTH2', 'Edge')`)
assert.equal((await one(`select count(*)::int c from push_subscriptions`)).c, 1); ok('saving the same device twice updates it')
await as(M, `select save_push_subscription('https://push.example/abc', 'BKEY3', 'AUTH3', 'Edge')`)
assert.equal((await one(`select user_id from push_subscriptions`)).user_id, M); ok('a shared device moves to whoever signed in last')
assert.equal((await as(S, 'select * from push_subscriptions')).length, 0); ok('people only read their own devices')
await fails(S, `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://x', 'k', 'a')`, /permission denied|row-level/, [S]); ok('devices are only saved through the function')
await fails(X, `select save_push_subscription('https://push.example/z', 'k', 'a')`, /Not authorized/); ok('inactive users cannot subscribe')

// ---- a project where the website's schema ran first (WanderCafe-monset/supabase/schema.sql) ----
const web = new PGlite({ extensions: { btree_gist } })
await web.exec(`
  create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  create extension btree_gist;
  create table bookings (
    id bigint generated always as identity primary key, ref text not null unique, room_id text not null,
    check_in date not null, check_out date not null check (check_out > check_in), guests int not null check (guests > 0),
    name text not null, email text not null, phone text not null, total int not null, deposit int not null,
    status text not null default 'pending' check (status in ('pending', 'paid', 'checked_in', 'expired', 'conflict', 'cancelled')),
    payment_id text, created_at timestamptz not null default now(),
    constraint no_double_booking exclude using gist (room_id with =, daterange(check_in, check_out) with &&) where (status in ('pending', 'paid', 'checked_in')));
  insert into bookings (ref, room_id, check_in, check_out, guests, name, email, phone, total, deposit, status)
    values ('WDR-OLD001', 'room-a', '2030-03-01', '2030-03-03', 2, 'Web Guest', 'g@x.ph', '0917', 360000, 180000, 'paid');
  insert into auth.users (id, email) values ('${S}', 'staff@x');`) // signed up before the dashboard schema: no profile yet
await web.exec(sql)
await web.exec(sql)
await web.exec(`insert into profiles (id, full_name, role) select id, email, 'staff' from auth.users where id = '${S}' on conflict (id) do update set role = 'staff'`)
const old = (await web.query(`select status, paid from bookings where ref = 'WDR-OLD001'`)).rows[0]
assert.deepEqual([old.status, old.paid], ['confirmed', 180000]); ok("website's 'paid' booking becomes confirmed with its deposit paid")
await web.query(`select set_config('request.jwt.claim.sub', $1, false)`, [S])
await web.exec('set role authenticated')
const nb = (await web.query(`insert into bookings (room_id, check_in, check_out, name, phone, source, status) values ('room-b', '2030-03-01', '2030-03-02', 'Walk In', '0918', 'walk_in', 'confirmed') returning ref, created_by`)).rows[0]
await assert.rejects(web.query(`insert into bookings (room_id, check_in, check_out, name, phone, source, status) values ('room-a', '2030-03-02', '2030-03-04', 'Clash', '0918', 'phone', 'confirmed')`), /no_double_booking/)
await web.exec('reset role')
assert.match(nb.ref, /^WDR-/); assert.equal(nb.created_by, S); ok('upgraded table: staff books with a generated ref; overlaps still refused')

console.log(`\nall ${n} checks passed`)
